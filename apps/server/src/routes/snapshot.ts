import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { loadSnapshot, saveSnapshot } from "@archon/context";
import { sessionMiddleware } from "../middleware/session.js";
import { getDb, agents, companyMembers } from "@archon/db";

export const snapshotRouter = new Hono();

// Require session auth for all snapshot routes
snapshotRouter.use("/agent/snapshot*", sessionMiddleware);

// Helper: verify user can access the given agentId (must share a company)
async function canAccessAgent(userId: string, agentId: string): Promise<boolean> {
  const db = getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) return false;
  // Check that this user is a member of the agent's company
  const rows = await db
    .select()
    .from(companyMembers)
    .where(eq(companyMembers.companyId, agent.companyId));
  return rows.some((r) => r.userId === userId);
}

// GET /agent/snapshot?agentId=&taskId=
snapshotRouter.get(
  "/agent/snapshot",
  zValidator(
    "query",
    z.object({
      agentId: z.string().min(1),
      taskId: z.string().optional(),
    })
  ),
  async (c) => {
    const user = c.get("user");
    const { agentId, taskId } = c.req.valid("query");
    if (!(await canAccessAgent(user.id, agentId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const snapshot = await loadSnapshot(agentId, taskId ?? null);
    return c.json(snapshot);
  }
);

const snapshotDataSchema = z.object({
  schema_version: z.literal("1"),
  agent_id: z.string(),
  task_id: z.string().nullable(),
  heartbeat_count: z.number().int().nonnegative(),
  mission: z.object({
    company_goal: z.string(),
    project_goal: z.string(),
    my_role: z.string(),
    current_task: z.string(),
  }),
  progress: z.object({
    status: z.string(),
    percent_complete: z.number(),
    completed_steps: z.array(z.string()),
    next_steps: z.array(z.string()),
  }),
  decisions: z.array(
    z.object({
      timestamp: z.string(),
      decision: z.string(),
      rationale: z.string(),
    })
  ),
  artifacts: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      path: z.string().optional(),
    })
  ),
  human_feedback: z.array(
    z.object({
      timestamp: z.string(),
      content: z.string(),
      author: z.string(),
    })
  ),
  context_vars: z.record(z.string()),
});

const postSnapshotSchema = z.object({
  agentId: z.string().min(1),
  taskId: z.string().nullable().optional(),
  data: snapshotDataSchema,
});

// POST /agent/snapshot
snapshotRouter.post(
  "/agent/snapshot",
  zValidator("json", postSnapshotSchema),
  async (c) => {
    const user = c.get("user");
    const { agentId, taskId, data } = c.req.valid("json");
    if (!(await canAccessAgent(user.id, agentId))) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await saveSnapshot(agentId, taskId ?? null, data);
    return c.json({ success: true }, 201);
  }
);
