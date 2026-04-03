import { getDb, agentSnapshots } from "@archon/db";
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

export async function loadSnapshot(
  agentId: string,
  taskId: string | null
): Promise<SnapshotData> {
  const db = getDb();

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
  data: SnapshotData
): Promise<void> {
  const db = getDb();
  const trimmed = trimSnapshot(data);
  const tokenEstimate = estimateTokens(trimmed);

  await db.insert(agentSnapshots).values({
    id: randomUUID(),
    agentId,
    taskId,
    heartbeatCount: trimmed.heartbeat_count,
    content: trimmed,
    tokenEstimate,
  });
}
