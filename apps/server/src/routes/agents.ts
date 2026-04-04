import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, count } from "drizzle-orm";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { getDb, agents, agentApiKeys, companyMembers, heartbeats } from "@archon/db";
import { desc } from "drizzle-orm";
import { sessionMiddleware } from "../middleware/session.js";

export const agentsRouter = new Hono();

// Apply session middleware to all agents routes
agentsRouter.use("/companies/:companyId/agents*", sessionMiddleware);
agentsRouter.use("/companies/:companyId/api-keys*", sessionMiddleware);

// Helper: verify user is a member of the company, return membership
async function getMembership(companyId: string, userId: string) {
  const db = getDb();
  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  return membership ?? null;
}

// Helper: generate API key
function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "pf_" + randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 10);
  return { raw, hash, prefix };
}

const adapterConfigSchema = z.object({
  url: z.string().optional(),
  reviewPolicy: z.enum(["always", "never"]).or(z.string().regex(/^if_cost_above_\d+(?:\.\d+)?$/)).optional(),
}).passthrough();

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  role: z.string().min(1).max(255),
  parentAgentId: z.string().optional(),
  adapterType: z.enum(["claude_code", "codex", "opencode", "http"]).default("http"),
  llmConfig: z
    .object({ provider: z.string(), model: z.string() })
    .default({ provider: "anthropic", model: "claude-opus-4-5" }),
  adapterConfig: adapterConfigSchema.optional(),
  heartbeatCron: z.string().optional(),
  monthlyBudgetUsd: z.string().optional(),
  workspacePath: z.string().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.string().min(1).max(255).optional(),
  parentAgentId: z.string().nullable().optional(),
  adapterType: z.enum(["claude_code", "codex", "opencode", "http"]).optional(),
  llmConfig: z.object({ provider: z.string(), model: z.string() }).optional(),
  adapterConfig: adapterConfigSchema.optional(),
  heartbeatCron: z.string().nullable().optional(),
  monthlyBudgetUsd: z.string().optional(),
  workspacePath: z.string().nullable().optional(),
  status: z.enum(["active", "paused", "terminated"]).optional(),
});

// GET /companies/:companyId/agents — list agents in company
agentsRouter.get("/companies/:companyId/agents", async (c) => {
  const user = c.get("user");
  const { companyId } = c.req.param();
  const { page: pageStr, pageSize: pageSizeStr } = c.req.query();
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr ?? "50", 10) || 50));
  const offset = (page - 1) * pageSize;
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const where = eq(agents.companyId, companyId);
  const countResult = await db.select({ total: count() }).from(agents).where(where);
  const total = countResult[0]?.total ?? 0;
  const rows = await db
    .select()
    .from(agents)
    .where(where)
    .limit(pageSize)
    .offset(offset);

  return c.json({ data: rows, total, page, pageSize, pageCount: Math.ceil(total / pageSize) });
});

// POST /companies/:companyId/agents — create agent (board/manager only)
agentsRouter.post(
  "/companies/:companyId/agents",
  zValidator("json", createAgentSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    const membership = await getMembership(companyId, user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board" && membership.role !== "manager") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const id = randomUUID();
    await db.insert(agents).values({
      id,
      companyId,
      parentAgentId: body.parentAgentId ?? null,
      name: body.name,
      role: body.role,
      adapterType: body.adapterType,
      llmConfig: body.llmConfig,
      adapterConfig: body.adapterConfig ?? {},
      heartbeatCron: body.heartbeatCron ?? null,
      monthlyBudgetUsd: body.monthlyBudgetUsd ?? "0",
      workspacePath: body.workspacePath ?? null,
      status: "active",
    });

    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return c.json(agent, 201);
  }
);

// PATCH /companies/:companyId/agents/:agentId — update agent (board/manager only)
agentsRouter.patch(
  "/companies/:companyId/agents/:agentId",
  zValidator("json", updateAgentSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId, agentId } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    const membership = await getMembership(companyId, user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board" && membership.role !== "manager") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
    if (!existing) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const updates: Partial<typeof agents.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.role !== undefined) updates.role = body.role;
    if (body.parentAgentId !== undefined) updates.parentAgentId = body.parentAgentId;
    if (body.adapterType !== undefined) updates.adapterType = body.adapterType;
    if (body.llmConfig !== undefined) updates.llmConfig = body.llmConfig;
    if (body.adapterConfig !== undefined) updates.adapterConfig = body.adapterConfig;
    if (body.heartbeatCron !== undefined) updates.heartbeatCron = body.heartbeatCron;
    if (body.monthlyBudgetUsd !== undefined) updates.monthlyBudgetUsd = body.monthlyBudgetUsd;
    if (body.workspacePath !== undefined) updates.workspacePath = body.workspacePath;
    if (body.status !== undefined) updates.status = body.status;

    await db.update(agents).set(updates).where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));

    const [updated] = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
    return c.json(updated);
  }
);

// DELETE /companies/:companyId/agents/:agentId — delete agent (board only)
agentsRouter.delete("/companies/:companyId/agents/:agentId", async (c) => {
  const user = c.get("user");
  const { companyId, agentId } = c.req.param();
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }
  if (membership.role !== "board") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [existing] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
  if (!existing) {
    return c.json({ error: "Agent not found" }, 404);
  }

  await db.delete(agents).where(eq(agents.id, agentId));
  return c.json({ success: true });
});

// POST /companies/:companyId/agents/:agentId/api-keys — generate API key (board only)
agentsRouter.post("/companies/:companyId/agents/:agentId/api-keys", async (c) => {
  const user = c.get("user");
  const { companyId, agentId } = c.req.param();
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }
  if (membership.role !== "board") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
  if (!agent) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const { raw, hash, prefix } = generateApiKey();
  const id = randomUUID();

  await db.insert(agentApiKeys).values({
    id,
    agentId,
    companyId,
    keyHash: hash,
    keyPrefix: prefix,
    scopes: [],
  });

  // Return the raw key once — it will never be retrievable again
  return c.json({ key: raw, prefix, id }, 201);
});

// GET /companies/:companyId/agents/:agentId/api-keys — list API keys (prefixes only)
agentsRouter.get("/companies/:companyId/agents/:agentId/api-keys", async (c) => {
  const user = c.get("user");
  const { companyId, agentId } = c.req.param();
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
  if (!agent) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const keys = await db
    .select({
      id: agentApiKeys.id,
      keyPrefix: agentApiKeys.keyPrefix,
      scopes: agentApiKeys.scopes,
      lastUsedAt: agentApiKeys.lastUsedAt,
      expiresAt: agentApiKeys.expiresAt,
      revokedAt: agentApiKeys.revokedAt,
      createdAt: agentApiKeys.createdAt,
    })
    .from(agentApiKeys)
    .where(eq(agentApiKeys.agentId, agentId));

  return c.json(keys);
});

// DELETE /companies/:companyId/api-keys/:keyId — revoke (board only)
agentsRouter.delete("/companies/:companyId/api-keys/:keyId", async (c) => {
  const user = c.get("user");
  const { companyId, keyId } = c.req.param();
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }
  if (membership.role !== "board") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [key] = await db
    .select()
    .from(agentApiKeys)
    .where(and(eq(agentApiKeys.id, keyId), eq(agentApiKeys.companyId, companyId)));
  if (!key) {
    return c.json({ error: "API key not found" }, 404);
  }

  await db
    .update(agentApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(agentApiKeys.id, keyId));

  return c.json({ success: true });
});

// GET /companies/:companyId/agents/:agentId/heartbeats — list heartbeats for an agent
agentsRouter.get("/companies/:companyId/agents/:agentId/heartbeats", async (c) => {
  const user = c.get("user");
  const { companyId, agentId } = c.req.param();
  const { page: pageStr, pageSize: pageSizeStr } = c.req.query();
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr ?? "25", 10) || 25));
  const offset = (page - 1) * pageSize;
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) return c.json({ error: "Not found" }, 404);

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
  if (!agent) return c.json({ error: "Agent not found" }, 404);

  const where = eq(heartbeats.agentId, agentId);
  const hbCount = await db.select({ total: count() }).from(heartbeats).where(where);
  const total = hbCount[0]?.total ?? 0;
  const rows = await db
    .select()
    .from(heartbeats)
    .where(where)
    .orderBy(desc(heartbeats.startedAt))
    .limit(pageSize)
    .offset(offset);

  return c.json({ data: rows, total, page, pageSize, pageCount: Math.ceil(total / pageSize) });
});
