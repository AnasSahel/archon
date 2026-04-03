import { getDb, agentSnapshots, agentMemory } from "@archon/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const SNAPSHOT_LIMITS = {
  mission: 200,
  progress: 300,
  decisions: 400,
  artifacts: 300,
  human_feedback: 200,
  context_vars: 150,
  total_target: 1500,
};

export interface SnapshotData {
  schema_version: "1";
  agent_id: string;
  task_id: string | null;
  heartbeat_count: number;
  mission: {
    company_goal: string;
    project_goal: string;
    my_role: string;
    current_task: string;
  };
  progress: {
    status: string;
    percent_complete: number;
    completed_steps: string[];
    next_steps: string[];
  };
  decisions: Array<{ timestamp: string; decision: string; rationale: string }>;
  artifacts: Array<{ name: string; description: string; path?: string | undefined }>;
  human_feedback: Array<{ timestamp: string; content: string; author: string }>;
  context_vars: Record<string, string>;
}

function makeEmptySnapshot(agentId: string, taskId: string | null): SnapshotData {
  return {
    schema_version: "1",
    agent_id: agentId,
    task_id: taskId,
    heartbeat_count: 0,
    mission: {
      company_goal: "",
      project_goal: "",
      my_role: "",
      current_task: "",
    },
    progress: {
      status: "not_started",
      percent_complete: 0,
      completed_steps: [],
      next_steps: [],
    },
    decisions: [],
    artifacts: [],
    human_feedback: [],
    context_vars: {},
  };
}

export function estimateTokens(data: SnapshotData): number {
  return Math.ceil(JSON.stringify(data).length / 4);
}

export function trimSnapshot(data: SnapshotData): SnapshotData {
  if (estimateTokens(data) <= SNAPSHOT_LIMITS.total_target) {
    return data;
  }

  return {
    ...data,
    decisions: data.decisions.slice(-5),
    progress: {
      ...data.progress,
      completed_steps: data.progress.completed_steps.slice(-5),
    },
    artifacts: data.artifacts.slice(-5),
    human_feedback: data.human_feedback.slice(-3),
  };
}

/**
 * Format snapshot as a compact human-readable prompt string for injection into
 * the agent system prompt. Keeps token usage low by using concise formatting.
 */
export function toPromptString(data: SnapshotData): string {
  const lines: string[] = ["[AGENT CONTEXT SNAPSHOT]"];

  lines.push(`Heartbeat: #${data.heartbeat_count}`);

  if (data.mission.my_role) lines.push(`Role: ${data.mission.my_role}`);
  if (data.mission.current_task) lines.push(`Task: ${data.mission.current_task}`);
  if (data.mission.project_goal) lines.push(`Project goal: ${data.mission.project_goal}`);

  lines.push(`Progress: ${data.progress.status} (${data.progress.percent_complete}%)`);

  if (data.progress.next_steps.length > 0) {
    lines.push("Next steps:");
    data.progress.next_steps.slice(0, 3).forEach((s) => lines.push(`  - ${s}`));
  }

  if (data.progress.completed_steps.length > 0) {
    const recent = data.progress.completed_steps.slice(-3);
    lines.push(`Completed: ${recent.join(", ")}`);
  }

  if (data.decisions.length > 0) {
    lines.push("Recent decisions:");
    data.decisions.slice(-3).forEach((d) =>
      lines.push(`  [${d.timestamp.slice(0, 10)}] ${d.decision}`)
    );
  }

  if (data.artifacts.length > 0) {
    lines.push(`Artifacts: ${data.artifacts.map((a) => a.name).join(", ")}`);
  }

  if (data.human_feedback.length > 0) {
    const latest = data.human_feedback[data.human_feedback.length - 1]!;
    lines.push(`Human feedback: ${latest.content}`);
  }

  if (Object.keys(data.context_vars).length > 0) {
    lines.push("Context vars:");
    Object.entries(data.context_vars).forEach(([k, v]) => lines.push(`  ${k}=${v}`));
  }

  lines.push("[END CONTEXT]");
  return lines.join("\n");
}

export async function loadSnapshot(
  agentId: string,
  taskId: string | null
): Promise<SnapshotData> {
  const db = getDb();

  // Try agent_memory (type=snapshot) first — canonical storage for C6+
  const memRows = await db
    .select()
    .from(agentMemory)
    .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.type, "snapshot")))
    .orderBy(desc(agentMemory.createdAt))
    .limit(1);

  if (memRows[0]) {
    try {
      return JSON.parse(memRows[0].content) as SnapshotData;
    } catch {
      // Malformed content — fall through to agentSnapshots
    }
  }

  // Fallback: legacy agentSnapshots table
  const rows = await db
    .select()
    .from(agentSnapshots)
    .where(
      taskId !== null
        ? and(eq(agentSnapshots.agentId, agentId), eq(agentSnapshots.taskId, taskId))
        : and(eq(agentSnapshots.agentId, agentId), isNull(agentSnapshots.taskId))
    )
    .orderBy(desc(agentSnapshots.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return makeEmptySnapshot(agentId, taskId);
  }

  return row.content as SnapshotData;
}

export async function saveSnapshot(
  agentId: string,
  taskId: string | null,
  data: SnapshotData,
  companyId?: string
): Promise<void> {
  const db = getDb();
  const trimmed = trimSnapshot(data);
  const tokenEstimate = estimateTokens(trimmed);
  const content = JSON.stringify(trimmed);

  // Write to agent_memory (type=snapshot) when companyId is known
  if (companyId) {
    const existing = await db
      .select({ id: agentMemory.id })
      .from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.type, "snapshot")))
      .limit(1);

    if (existing[0]) {
      // Update in place — snapshots are upserted, not appended
      await db
        .update(agentMemory)
        .set({
          content,
          heartbeatCount: trimmed.heartbeat_count,
          metadata: { tokenEstimate, taskId },
          updatedAt: new Date(),
        })
        .where(eq(agentMemory.id, existing[0].id));
    } else {
      await db.insert(agentMemory).values({
        id: randomUUID(),
        agentId,
        companyId,
        type: "snapshot",
        content,
        heartbeatCount: trimmed.heartbeat_count,
        metadata: { tokenEstimate, taskId },
      });
    }
  }

  // Also write to legacy agentSnapshots for backward compatibility
  await db.insert(agentSnapshots).values({
    id: randomUUID(),
    agentId,
    taskId,
    heartbeatCount: trimmed.heartbeat_count,
    content: trimmed,
    tokenEstimate,
  });
}
