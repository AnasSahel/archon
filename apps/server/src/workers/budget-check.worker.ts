import { Worker, type Job } from "bullmq";
import { getRedis } from "../lib/valkey.js";
import { getDb, agentBudgets, agents } from "@archon/db";
import { eq, and } from "drizzle-orm";

export interface BudgetCheckJobData {
  agentId: string;
}

export function startBudgetCheckWorker(): Worker {
  const worker = new Worker<BudgetCheckJobData>(
    "budget-check",
    async (job: Job<BudgetCheckJobData>) => {
      const { agentId } = job.data;
      const month = new Date().toISOString().slice(0, 7);  // "2026-04"
      const db = getDb();

      const [budget] = await db
        .select()
        .from(agentBudgets)
        .where(and(eq(agentBudgets.agentId, agentId), eq(agentBudgets.periodMonth, month)));

      if (!budget) return;

      const spent = parseFloat(budget.spentUsd as string);
      const limit = parseFloat(budget.budgetUsd as string);

      if (spent >= limit && budget.status === "active") {
        await db
          .update(agentBudgets)
          .set({ status: "exceeded", pausedAt: new Date() })
          .where(eq(agentBudgets.id, budget.id));

        await db
          .update(agents)
          .set({ status: "paused" })
          .where(eq(agents.id, agentId));

        console.log(`[budget-check] Agent ${agentId} paused — budget exceeded (${spent}/${limit} USD)`);
      }
    },
    { connection: getRedis() }
  );

  return worker;
}
