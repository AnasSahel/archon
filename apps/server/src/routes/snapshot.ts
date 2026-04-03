import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { loadSnapshot, saveSnapshot } from "@archon/context";
import { sessionMiddleware } from "../middleware/session.js";
import { getDb, agents, agentMemory, companyMembers } from "@archon/db";

export const snapshotRouter = new Hono();

// Require session auth for all snapshot routes
snapshotRouter.use("/agent/snapshot*", sessionMiddleware);
snapshotRouter.use("/companies/:companyId/agents/:agentId/context", sessionMiddleware);

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

// GET /companies/:companyId/agents/:agentId/context
// Returns the latest snapshot from agent_memory, plus metadata for the UI Context tab.
snapshotRouter.get("/companies/:companyId/agents/:agentId/context", async (c) => {
  const user = c.get("user");
  const { companyId, agentId } = c.req.param();
  const db = getDb();

  // Verify membership
  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)));
  if (!membership) return c.json({ error: "Forbidden" }, 403);

  // Verify agent belongs to company
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
  if (!agent) return c.json({ error: "Not found" }, 404);

  // Load latest snapshot from agent_memory
  const [memRow] = await db
    .select()
    .from(agentMemory)
    .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.type, "snapshot")))
    .orderBy(desc(agentMemory.updatedAt))
    .limit(1);

  if (!memRow) {
    // Fall back to legacy loadSnapshot
    const snapshot = await loadSnapshot(agentId, null);
    return c.json({
      snapshot,
      heartbeatCount: snapshot.heartbeat_count,
      tokenEstimate: Math.ceil(JSON.stringify(snapshot).length / 4),
      nextCompressionAt: 10 - (snapshot.heartbeat_count % 10),
      updatedAt: null,
    });
  }

  let snapshot: ReturnType<typeof JSON.parse>;
  try {
    snapshot = JSON.parse(memRow.content);
  } catch {
    return c.json({ error: "Malformed snapshot" }, 500);
  }

  const tokenEstimate = (memRow.metadata as Record<string, unknown>)?.tokenEstimate as number
    ?? Math.ceil(memRow.content.length / 4);

  return c.json({
    snapshot,
    heartbeatCount: memRow.heartbeatCount,
    tokenEstimate,
    nextCompressionAt: 10 - (memRow.heartbeatCount % 10),
    updatedAt: memRow.updatedAt,
  });
});
