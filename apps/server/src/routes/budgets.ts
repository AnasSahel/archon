import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { getDb, agentBudgets, agents, companyMembers } from "@archon/db";
import { sessionMiddleware } from "../middleware/session.js";
import { getRedis } from "../lib/valkey.js";

export const budgetsRouter = new Hono();

// Apply session middleware
budgetsRouter.use("/companies/:companyId/budgets*", sessionMiddleware);
budgetsRouter.use("/companies/:companyId/agents/:agentId/budget*", sessionMiddleware);

// Helper: verify user is a member of the company, return membership
async function getMembership(companyId: string, userId: string) {
  const db = getDb();
  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  return membership ?? null;
}

// Helper: get current month string e.g. "2026-04"
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// trackCost — exported for Phase 10 use
// Increments spentUsd on the current month's budget record and enqueues a budget-check job
export async function trackCost(agentId: string, costUsd: number): Promise<void> {
  const db = getDb();
  const month = currentMonth();

  // Try to get existing budget record
  const [existing] = await db
    .select()
    .from(agentBudgets)
    .where(and(eq(agentBudgets.agentId, agentId), eq(agentBudgets.periodMonth, month)));

  if (existing) {
    const newSpent = parseFloat(existing.spentUsd as string) + costUsd;
    await db
      .update(agentBudgets)
      .set({ spentUsd: newSpent.toFixed(4) })
      .where(eq(agentBudgets.id, existing.id));
  } else {
    // No budget record yet — create one with no limit (budget_usd = 0 means no explicit limit set)
    await db.insert(agentBudgets).values({
      id: randomUUID(),
      agentId,
      periodMonth: month,
      budgetUsd: "0",
      spentUsd: costUsd.toFixed(4),
      status: "active",
    });
  }

  // Enqueue budget-check job (graceful fallback if Redis unavailable)
  try {
    const queue = new Queue("budget-check", { connection: getRedis() });
    await queue.add("check", { agentId });
  } catch (err) {
    console.warn("[trackCost] Failed to enqueue budget-check job:", err);
  }
}

// GET /companies/:companyId/budgets — list all agents with their current month budget
budgetsRouter.get("/companies/:companyId/budgets", async (c) => {
  const user = c.get("user");
  const { companyId } = c.req.param();
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const month = currentMonth();

  // Fetch all agents in the company
  const agentRows = await db
    .select()
    .from(agents)
    .where(eq(agents.companyId, companyId));

  // Fetch budgets for the current month for all agents in this company
  const budgetRows = await db
    .select()
    .from(agentBudgets)
    .where(eq(agentBudgets.periodMonth, month));

  const budgetByAgentId = new Map(budgetRows.map((b) => [b.agentId, b]));

  const result = agentRows.map((agent) => {
    const budget = budgetByAgentId.get(agent.id);
    const budgetUsd = budget ? parseFloat(budget.budgetUsd as string) : 0;
    const spentUsd = budget ? parseFloat(budget.spentUsd as string) : 0;
    const percentUsed = budgetUsd > 0 ? Math.min(100, (spentUsd / budgetUsd) * 100) : 0;

    return {
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
      budgetUsd: budgetUsd.toFixed(4),
      spentUsd: spentUsd.toFixed(4),
      percentUsed: parseFloat(percentUsed.toFixed(2)),
      status: budget?.status ?? "active",
      periodMonth: month,
    };
  });

  return c.json(result);
});

const setBudgetSchema = z.object({
  budgetUsd: z.string().min(1),
  periodMonth: z.string().optional(),
});

// PATCH /companies/:companyId/agents/:agentId/budget — set/update monthly budget (board only)
budgetsRouter.patch(
  "/companies/:companyId/agents/:agentId/budget",
  zValidator("json", setBudgetSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId, agentId } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    const membership = await getMembership(companyId, user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board") {
      return c.json({ error: "Forbidden" }, 403);
    }

    // Verify agent belongs to this company
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const month = body.periodMonth ?? currentMonth();

    // Check if a budget record already exists for this agent + month
    const [existing] = await db
      .select()
      .from(agentBudgets)
      .where(and(eq(agentBudgets.agentId, agentId), eq(agentBudgets.periodMonth, month)));

    if (existing) {
      await db
        .update(agentBudgets)
        .set({ budgetUsd: body.budgetUsd, status: "active", pausedAt: null })
        .where(eq(agentBudgets.id, existing.id));

      const [updated] = await db
        .select()
        .from(agentBudgets)
        .where(eq(agentBudgets.id, existing.id));
      return c.json(updated);
    } else {
      const id = randomUUID();
      await db.insert(agentBudgets).values({
        id,
        agentId,
        periodMonth: month,
        budgetUsd: body.budgetUsd,
        spentUsd: "0",
        status: "active",
      });

      const [created] = await db
        .select()
        .from(agentBudgets)
        .where(eq(agentBudgets.id, id));
      return c.json(created, 201);
    }
  }
);
