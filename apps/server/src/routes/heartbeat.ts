import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Queue } from "bullmq";
import { eq, and } from "drizzle-orm";
import { getDb, agents, agentBudgets, companyMembers } from "@archon/db";
import { sessionMiddleware } from "../middleware/session.js";
import { getRedis } from "../lib/valkey.js";

export const heartbeatRouter = new Hono();

heartbeatRouter.use("/companies/:companyId/agents/:agentId/heartbeat", sessionMiddleware);

const triggerSchema = z.object({
  taskId: z.string().optional(),
});

// POST /api/companies/:companyId/agents/:agentId/heartbeat
// Trigger a heartbeat execution for an agent (board/manager only)
heartbeatRouter.post(
  "/companies/:companyId/agents/:agentId/heartbeat",
  zValidator("json", triggerSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId, agentId } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    // Verify user is a member of the company
    const [membership] = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)));
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board" && membership.role !== "manager") {
      return c.json({ error: "Forbidden" }, 403);
    }

    // Verify agent belongs to company
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    // Check budget — refuse if agent is paused due to budget exceeded
    if (agent.status === "paused") {
      const month = new Date().toISOString().slice(0, 7);
      const [budget] = await db
        .select()
        .from(agentBudgets)
        .where(and(eq(agentBudgets.agentId, agentId), eq(agentBudgets.periodMonth, month)));
      if (budget?.status === "exceeded") {
        return c.json({ error: "Agent budget exceeded — cannot trigger heartbeat" }, 402);
      }
    }
    if (agent.status === "terminated") {
      return c.json({ error: "Agent is terminated" }, 409);
    }

    // Enqueue heartbeat job
    const queue = new Queue("heartbeat", { connection: getRedis() });
    const job = await queue.add("heartbeat", {
      agentId,
      companyId,
      ...(body.taskId !== undefined ? { taskId: body.taskId } : {}),
      adapterType: agent.adapterType,
      workspacePath: agent.workspacePath,
    });

    return c.json({ jobId: job.id });
  }
);
