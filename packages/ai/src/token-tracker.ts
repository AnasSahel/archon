import { randomUUID } from "node:crypto";
import { getDb, heartbeats, agentBudgets } from "@archon/db";
import { eq, and } from "drizzle-orm";

export interface TokenUsage {
  agentId: string;
  taskId?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export async function recordHeartbeat(
  usage: TokenUsage,
  status: "completed" | "failed" = "completed",
  startedAt?: Date
): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db.insert(heartbeats).values({
    id: randomUUID(),
    agentId: usage.agentId,
    taskId: usage.taskId ?? null,
    status,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd.toFixed(6),
    startedAt: startedAt ?? now,
    completedAt: now,
  });

  // Update monthly budget spent
  const month = now.toISOString().slice(0, 7);
  const existing = await db
    .select()
    .from(agentBudgets)
    .where(
      and(
        eq(agentBudgets.agentId, usage.agentId),
        eq(agentBudgets.periodMonth, month)
      )
    );

  if (existing.length > 0 && existing[0]) {
    const newSpent =
      parseFloat(existing[0].spentUsd as string) + usage.costUsd;
    await db
      .update(agentBudgets)
      .set({ spentUsd: newSpent.toFixed(4) })
      .where(eq(agentBudgets.id, existing[0].id));
  }
}
