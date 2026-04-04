import { Worker, type Job } from "bullmq";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { getRedis } from "../lib/valkey.js";
import { resolveExecutionMode } from "../runtime/execution-router.js";
import { runViaDocker } from "../runtime/docker-runner.js";
import { runViaLocal } from "../runtime/local-runner.js";
import { writeToolPolicy } from "../runtime/tool-policy-writer.js";
import { dispatch } from "@archon/notifications";
import { getDb, agents, tasks, taskComments, heartbeats, agentApiKeys } from "@archon/db";
import { eq } from "drizzle-orm";
import { trackCost } from "../routes/budgets.js";
import { transitionHitl, getHitlSnapshot } from "../lib/hitl-service.js";
import { scheduleHitlEscalation } from "./hitl-escalation.worker.js";
import type { AdapterType } from "@archon/tool-policy";
import {
  loadSnapshot,
  saveSnapshot,
  estimateTokens,
  shouldSummarize,
  summarizeSnapshot,
  toPromptString,
} from "@archon/context";

export interface HeartbeatJobData {
  agentId: string;
  companyId: string;
  taskId?: string;
  adapterType?: string;
  workspacePath?: string | null;
}

// Token pricing defaults (per 1M tokens)
const PRICE_INPUT_PER_M = 3.0;   // $3 / 1M input tokens
const PRICE_OUTPUT_PER_M = 15.0; // $15 / 1M output tokens

// Docker image names per adapter type
const DOCKER_IMAGE_MAP: Record<string, string> = {
  claude_code: process.env.DOCKER_IMAGE_CLAUDE ?? "archon-agent-claude:latest",
  codex: process.env.DOCKER_IMAGE_CODEX ?? "archon-agent-codex:latest",
  opencode: process.env.DOCKER_IMAGE_OPENCODE ?? "archon-agent-opencode:latest",
};

// Default CLI commands per adapter type
const DOCKER_COMMAND_MAP: Record<string, string[]> = {
  claude_code: [
    "claude",
    "--dangerously-skip-permissions",
    "--print",
    "-p",
    "You are running in an Archon heartbeat container. Use the paperclip skill to complete your assigned tasks.",
  ],
  codex: ["codex", "--approval-mode", "full-auto", "Complete your assigned tasks."],
  opencode: ["opencode", "run"],
};

function generateRunApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "pf_" + randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 10);
  return { raw, hash, prefix };
}

export function startHeartbeatWorker(): Worker {
  const worker = new Worker<HeartbeatJobData>(
    "heartbeat",
    async (job: Job<HeartbeatJobData>) => {
      const { agentId, taskId } = job.data;
      const db = getDb();

      // Load agent
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
      if (!agent) {
        console.error(`[heartbeat] Agent ${agentId} not found`);
        return;
      }

      // Load task (optional)
      const task = taskId
        ? (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0] ?? null
        : null;

      // Skip execution if task is awaiting human review
      if (task?.status === "awaiting_human") {
        console.log(`[heartbeat] Task ${taskId} is awaiting_human — skipping execution`);
        return;
      }

      // Record heartbeat start
      const heartbeatId = randomUUID();
      await db.insert(heartbeats).values({
        id: heartbeatId,
        agentId,
        ...(taskId !== undefined ? { taskId } : {}),
        status: "running",
        startedAt: new Date(),
      });

      // Mark task in_progress
      if (task) {
        await db
          .update(tasks)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(tasks.id, task.id));
      }

      dispatch({
        type: "heartbeat_started",
        agentId,
        ...(taskId !== undefined ? { taskId } : {}),
      });

      const adapterType = job.data.adapterType ?? agent.adapterType;
      const adapterCfgForMode = (agent.adapterConfig ?? {}) as Record<string, unknown>;
      const mode = await resolveExecutionMode({
        adapterType,
        adapterConfig: adapterCfgForMode,
        ...(job.data.workspacePath !== undefined
          ? { workspacePath: job.data.workspacePath }
          : { workspacePath: agent.workspacePath }),
      });

      console.log(
        `[heartbeat] Agent ${agentId} (job ${job.id}) — mode: ${mode}, adapter: ${adapterType}`
      );

      const executionStartedAt = new Date();

      try {
        let resultText = "";
        let inputTokens = 0;
        let outputTokens = 0;

        if (mode === "docker") {
          const image = DOCKER_IMAGE_MAP[adapterType];
          if (!image) {
            throw new Error(`No Docker image configured for adapter type: ${adapterType}`);
          }

          const command = DOCKER_COMMAND_MAP[adapterType] ?? ["echo", "no command configured"];

          // Generate short-lived API key for this container run
          const { raw: runApiKey, hash, prefix } = generateRunApiKey();
          const runKeyId = randomUUID();
          const adapterCfg = (agent.adapterConfig ?? {}) as Record<string, unknown>;
          const containerTimeoutMs =
            typeof adapterCfg["containerTimeoutMs"] === "number"
              ? adapterCfg["containerTimeoutMs"]
              : parseInt(process.env.AGENT_CONTAINER_TIMEOUT_MS ?? "600000", 10);

          const keyExpiresAt = new Date(Date.now() + containerTimeoutMs + 60_000);
          await db.insert(agentApiKeys).values({
            id: runKeyId,
            agentId,
            companyId: agent.companyId,
            keyHash: hash,
            keyPrefix: prefix,
            scopes: ["heartbeat"],
            expiresAt: keyExpiresAt,
          });

          // Write tool policy config files into workspace before launching container
          const workspacePath = agent.workspacePath ?? job.data.workspacePath ?? null;
          if (workspacePath) {
            try {
              await writeToolPolicy({
                companyId: agent.companyId,
                agentId,
                agentRole: agent.role,
                adapterType: adapterType as AdapterType,
                workspacePath,
              });
            } catch (err) {
              console.warn(`[heartbeat] writeToolPolicy failed (non-fatal):`, err);
            }
          }

          // Build extra env vars (LLM API keys from server environment)
          const containerEnv: Record<string, string> = {
            PAPERCLIP_COMPANY_ID: agent.companyId,
          };
          if (taskId) containerEnv.PAPERCLIP_TASK_ID = taskId;
          if (process.env.ANTHROPIC_API_KEY) {
            containerEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
          }
          if (process.env.OPENAI_API_KEY) {
            containerEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
          }

          // Run the container with streaming output
          const logLines: string[] = [];
          try {
            await runViaDocker({
              agentId,
              ...(taskId !== undefined ? { taskId } : {}),
              image,
              command,
              env: containerEnv,
              apiKey: runApiKey,
              ...(workspacePath ? { workspacePath } : {}),
              onLog: (log) => {
                logLines.push(log);
                dispatch({
                  type: "heartbeat_token",
                  agentId,
                  ...(taskId !== undefined ? { taskId } : {}),
                  token: log,
                });
              },
            });
          } finally {
            // Always revoke the short-lived key after container exits
            await db
              .update(agentApiKeys)
              .set({ revokedAt: new Date() })
              .where(eq(agentApiKeys.id, runKeyId));
          }

          resultText = logLines.join("");
          // Token usage is not directly observable from container stdout in this phase.
          // The agent self-reports cost via heartbeat_completed events dispatched from inside the container.
          inputTokens = 0;
          outputTokens = 0;
        } else if (mode === "local") {
          const command = DOCKER_COMMAND_MAP[adapterType] ?? ["echo", "no command configured"];

          // Generate short-lived API key for this local run
          const { raw: runApiKey, hash, prefix } = generateRunApiKey();
          const runKeyId = randomUUID();
          const adapterCfg = (agent.adapterConfig ?? {}) as Record<string, unknown>;
          const containerTimeoutMs =
            typeof adapterCfg["containerTimeoutMs"] === "number"
              ? adapterCfg["containerTimeoutMs"]
              : parseInt(process.env.AGENT_CONTAINER_TIMEOUT_MS ?? "600000", 10);

          const keyExpiresAt = new Date(Date.now() + containerTimeoutMs + 60_000);
          await db.insert(agentApiKeys).values({
            id: runKeyId,
            agentId,
            companyId: agent.companyId,
            keyHash: hash,
            keyPrefix: prefix,
            scopes: ["heartbeat"],
            expiresAt: keyExpiresAt,
          });

          const workspacePath = agent.workspacePath ?? job.data.workspacePath ?? null;
          if (workspacePath) {
            try {
              await writeToolPolicy({
                companyId: agent.companyId,
                agentId,
                agentRole: agent.role,
                adapterType: adapterType as AdapterType,
                workspacePath,
              });
            } catch (err) {
              console.warn(`[heartbeat] writeToolPolicy failed (non-fatal):`, err);
            }
          }

          const localEnv: Record<string, string> = {
            PAPERCLIP_COMPANY_ID: agent.companyId,
            PAPERCLIP_AGENT_ID: agentId,
            PAPERCLIP_RUN_ID: heartbeatId,
          };
          if (taskId) localEnv.PAPERCLIP_TASK_ID = taskId;

          const logLines: string[] = [];
          try {
            await runViaLocal({
              agentId,
              ...(taskId !== undefined ? { taskId } : {}),
              command,
              env: localEnv,
              apiKey: runApiKey,
              ...(workspacePath ? { workspacePath } : {}),
              onLog: (log) => {
                logLines.push(log);
                dispatch({
                  type: "heartbeat_token",
                  agentId,
                  ...(taskId !== undefined ? { taskId } : {}),
                  token: log,
                });
              },
            });
          } finally {
            await db
              .update(agentApiKeys)
              .set({ revokedAt: new Date() })
              .where(eq(agentApiKeys.id, runKeyId));
          }

          resultText = logLines.join("");
          inputTokens = 0;
          outputTokens = 0;
        } else {
          // Load agent snapshot and inject into context
          const agentSnapshot = await loadSnapshot(agentId, taskId ?? null);

          // Build task context, injecting any human feedback from HITL state
          let contextText = task?.description ?? task?.title ?? "(no task context)";
          const hitlSnapshot = task ? await getHitlSnapshot(task.id) : null;
          const humanFeedback = hitlSnapshot?.context?.humanFeedback;
          if (humanFeedback) {
            contextText += `\n\n[Human feedback from previous review]: ${humanFeedback}`;
          }

          // Inject snapshot as compact prompt string (lower token usage than raw JSON)
          contextText += `\n\n${toPromptString(agentSnapshot)}`;

          // HTTP / external adapter execution
          if (adapterType === "http") {
            const adapterCfg = (agent.adapterConfig ?? {}) as Record<string, unknown>;
            const url = typeof adapterCfg["url"] === "string" ? adapterCfg["url"] : null;
            if (!url) {
              throw new Error(`Agent ${agentId} has adapterType=http but no adapterConfig.url`);
            }

            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId, taskId, context: contextText }),
            });

            if (!response.ok) {
              throw new Error(`HTTP adapter returned ${response.status}: ${await response.text()}`);
            }

            const data = (await response.json()) as {
              result: string;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            resultText = data.result ?? "";
            inputTokens = data.usage?.input_tokens ?? 0;
            outputTokens = data.usage?.output_tokens ?? 0;
          } else {
            // LLM-based adapters in non-docker mode — not yet supported
            throw new Error(`Adapter type '${adapterType}' requires Docker mode (set DOCKER_HOST)`);
          }

          // Update and save snapshot after HTTP execution
          const newHeartbeatCount = agentSnapshot.heartbeat_count + 1;
          let updatedSnapshot = {
            ...agentSnapshot,
            heartbeat_count: newHeartbeatCount,
          };

          // Auto-summarize every 10 heartbeats
          if (shouldSummarize(newHeartbeatCount)) {
            updatedSnapshot = await summarizeSnapshot(updatedSnapshot);
            // Post "Context compressed" comment
            if (task) {
              await db.insert(taskComments).values({
                id: randomUUID(),
                taskId: task.id,
                authorType: "agent",
                authorId: agentId,
                content: `**Context compressed** — heartbeat #${newHeartbeatCount}\n- Tokens after compression: ~${estimateTokens(updatedSnapshot)}`,
                commentType: "snapshot",
                metadata: { heartbeatId, type: "context_compressed" },
              });
            }
          }

          await saveSnapshot(agentId, taskId ?? null, updatedSnapshot, agent.companyId);
        }

        // Save result as task comment
        if (task) {
          await db.insert(taskComments).values({
            id: randomUUID(),
            taskId: task.id,
            authorType: "agent",
            authorId: agentId,
            content: resultText,
            commentType: "message",
            metadata: { heartbeatId, inputTokens, outputTokens },
          });

          // Execution summary snapshot comment
          const completedAt = new Date();
          const durationMs = completedAt.getTime() - executionStartedAt.getTime();
          const durationSec = (durationMs / 1000).toFixed(1);
          const costUsdPreview =
            (inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
            (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
          const snapshotContent =
            `**Heartbeat completed** — ${durationSec}s\n` +
            `- Input tokens: ${inputTokens}\n` +
            `- Output tokens: ${outputTokens}\n` +
            `- Estimated cost: $${costUsdPreview.toFixed(6)}\n` +
            `- Heartbeat ID: \`${heartbeatId}\``;
          await db.insert(taskComments).values({
            id: randomUUID(),
            taskId: task.id,
            authorType: "agent",
            authorId: agentId,
            content: snapshotContent,
            commentType: "snapshot",
            metadata: { heartbeatId, inputTokens, outputTokens, durationMs },
          });
        }

        const costUsd =
          (inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
          (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;

        // Determine post-execution HITL transition based on reviewPolicy
        if (task) {
          const adapterCfg = (agent.adapterConfig ?? {}) as Record<string, unknown>;
          const reviewPolicy = (adapterCfg["reviewPolicy"] as string | undefined) ?? "never";
          const requiresReview = evaluateReviewPolicy(reviewPolicy, costUsd);

          if (requiresReview) {
            // Transition task to AWAITING_HUMAN via XState
            await transitionHitl(
              task.id,
              { taskId: task.id, agentId, reviewRequired: true },
              { type: "RESULT_READY", requiresReview: true }
            );
            // Schedule auto-escalation timer
            await scheduleHitlEscalation({
              taskId: task.id,
              companyId: agent.companyId,
              agentId,
            });
            console.log(`[heartbeat] Task ${task.id} moved to awaiting_human — review required`);
          } else {
            // No review needed — mark done
            await db
              .update(tasks)
              .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
              .where(eq(tasks.id, task.id));
          }
        }

        // Budget tracking
        await trackCost(agentId, costUsd);

        // Mark heartbeat completed
        await db
          .update(heartbeats)
          .set({
            status: "completed",
            inputTokens,
            outputTokens,
            costUsd: costUsd.toFixed(6),
            completedAt: new Date(),
          })
          .where(eq(heartbeats.id, heartbeatId));

        dispatch({
          type: "heartbeat_completed",
          agentId,
          status: "completed",
          costUsd,
        });

        console.log(
          `[heartbeat] Completed — agent ${agentId}, tokens in=${inputTokens} out=${outputTokens}, cost=$${costUsd.toFixed(6)}`
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[heartbeat] Execution failed for agent ${agentId}:`, err);

        // Mark heartbeat failed
        await db
          .update(heartbeats)
          .set({ status: "failed", error: errMsg, completedAt: new Date() })
          .where(eq(heartbeats.id, heartbeatId));

        // Mark task escalated on failure
        if (task) {
          await db
            .update(tasks)
            .set({ status: "escalated", updatedAt: new Date() })
            .where(eq(tasks.id, task.id));
        }

        // Set agent status to error
        await db
          .update(agents)
          .set({ status: "error" })
          .where(eq(agents.id, agentId));

        dispatch({
          type: "agent_log",
          agentId,
          level: "error",
          message: errMsg,
        });

        throw err;
      }
    },
    {
      connection: getRedis(),
      concurrency: parseInt(process.env.HEARTBEAT_CONCURRENCY ?? "5", 10),
    }
  );

  worker.on("failed", (job, err) => {
    const attempt = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;
    if (attempt < maxAttempts) {
      console.warn(`[heartbeat] Job ${job?.id} failed (attempt ${attempt}/${maxAttempts}), will retry:`, err.message);
    } else {
      console.error(`[heartbeat] Job ${job?.id} permanently failed after ${attempt} attempts:`, err);
    }
  });

  return worker;
}

function evaluateReviewPolicy(policy: string, costUsd: number): boolean {
  if (policy === "always") return true;
  if (policy === "never") return false;
  // Support "if_cost_above_X" format, e.g. "if_cost_above_0.05"
  const match = policy.match(/^if_cost_above_(\d+(?:\.\d+)?)$/);
  if (match) {
    const threshold = parseFloat(match[1]!);
    return costUsd > threshold;
  }
  return false;
}
