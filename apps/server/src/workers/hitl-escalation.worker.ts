import { Worker, Queue, type Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { getRedis } from "../lib/valkey.js";
import { getDb, tasks, taskComments } from "@archon/db";
import { eq } from "drizzle-orm";
import { transitionHitl } from "../lib/hitl-service.js";

export interface HitlEscalationJobData {
  taskId: string;
  companyId: string;
  agentId: string;
}

export async function scheduleHitlEscalation(data: HitlEscalationJobData): Promise<void> {
  const timeoutMinutes = Number(process.env.HITL_ESCALATION_TIMEOUT_MINUTES ?? 30);
  const queue = new Queue<HitlEscalationJobData>("hitl-escalation", { connection: getRedis() });
  await queue.add("escalate", data, {
    delay: timeoutMinutes * 60 * 1000,
    // Deduplicate by taskId so re-reviews don't stack up stale jobs
    jobId: `hitl-escalation:${data.taskId}`,
  });
}

export function startHitlEscalationWorker(): Worker {
  const worker = new Worker<HitlEscalationJobData>(
    "hitl-escalation",
    async (job: Job<HitlEscalationJobData>) => {
      const { taskId, agentId } = job.data;
      const db = getDb();

      const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

      // Only escalate if still waiting — human may have already acted
      if (!task || task.status !== "awaiting_human") {
        console.log(`[hitl-escalation] Task ${taskId} no longer awaiting_human — skipping`);
        return;
      }

      // Transition to ESCALATED via XState
      await transitionHitl(
        taskId,
        { taskId, agentId, reviewRequired: true },
        { type: "TIMEOUT" }
      );

      // Log escalation as a comment
      await db.insert(taskComments).values({
        id: randomUUID(),
        taskId,
        authorType: "agent",
        authorId: "system",
        content: `Task automatically escalated — no human review within ${process.env.HITL_ESCALATION_TIMEOUT_MINUTES ?? 30} minutes.`,
        commentType: "escalate",
        metadata: { reason: "timeout" },
      });

      console.log(`[hitl-escalation] Task ${taskId} auto-escalated due to timeout`);
    },
    { connection: getRedis() }
  );

  worker.on("failed", (job, err) => {
    console.error(`[hitl-escalation] Job ${job?.id} failed:`, err);
  });

  return worker;
}
