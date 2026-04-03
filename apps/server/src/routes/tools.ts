import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, companyMembers, agents, toolPermissions } from "@archon/db";
import { sessionMiddleware } from "../middleware/session.js";
import { listTools, getEffectivePermissions, getAgentToolConfig } from "@archon/tool-policy";
import type { AdapterType } from "@archon/tool-policy";

export const toolsRouter = new Hono();

// Session guard for company tool routes
toolsRouter.use("/companies/:companyId/tools*", sessionMiddleware);
// Session guard for agent tool config
toolsRouter.use("/agent/tools", sessionMiddleware);

// Helper: verify user is a member of the company
async function getMembership(companyId: string, userId: string) {
  const db = getDb();
  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  return membership ?? null;
}

// GET /companies/:companyId/tools
// List all tools with effective permissions for the requesting user's agent context
toolsRouter.get("/companies/:companyId/tools", async (c) => {
  const user = c.get("user");
  const { companyId } = c.req.param();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  // Get all tools from the registry
  const tools = await listTools();

  // Get all permission rows for this company to annotate the list
  const db = getDb();
  const perms = await db
    .select()
    .from(toolPermissions)
    .where(eq(toolPermissions.companyId, companyId));

  const annotated = tools.map(tool => {
    const toolPerms = perms.filter(p => p.toolId === tool.id);
    return { ...tool, permissions: toolPerms };
  });

  return c.json(annotated);
});

const permissionEntrySchema = z.object({
  toolId: z.string(),
  agentId: z.string().nullable().optional(),
  agentRole: z.string().nullable().optional(),
  allow: z.boolean(),
  configOverride: z.record(z.unknown()).optional(),
});

const updatePermissionsSchema = z.object({
  permissions: z.array(permissionEntrySchema),
});

// PUT /companies/:companyId/tools/permissions
// Upsert permissions (board only)
toolsRouter.put(
  "/companies/:companyId/tools/permissions",
  zValidator("json", updatePermissionsSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId } = c.req.param();
    const { permissions } = c.req.valid("json");

    const membership = await getMembership(companyId, user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const db = getDb();

    for (const entry of permissions) {
      // Check if a matching permission already exists
      const existing = await db
        .select()
        .from(toolPermissions)
        .where(
          and(
            eq(toolPermissions.companyId, companyId),
            eq(toolPermissions.toolId, entry.toolId)
          )
        );

      // Find exact match on agentId + agentRole combination
      const match = existing.find(p => {
        const agentIdMatch = entry.agentId !== undefined
          ? p.agentId === entry.agentId
          : p.agentId === null;
        const roleMatch = entry.agentRole !== undefined
          ? p.agentRole === entry.agentRole
          : p.agentRole === null;
        return agentIdMatch && roleMatch;
      });

      if (match) {
        await db
          .update(toolPermissions)
          .set({
            allow: entry.allow,
            configOverride: entry.configOverride ?? {},
          })
          .where(eq(toolPermissions.id, match.id));
      } else {
        // Validate agentId if provided
        if (entry.agentId) {
          const [agent] = await db
            .select()
            .from(agents)
            .where(and(eq(agents.id, entry.agentId), eq(agents.companyId, companyId)));
          if (!agent) {
            return c.json({ error: `Agent ${entry.agentId} not found` }, 404);
          }
        }

        await db.insert(toolPermissions).values({
          id: randomUUID(),
          companyId,
          toolId: entry.toolId,
          agentId: entry.agentId ?? null,
          agentRole: entry.agentRole ?? null,
          allow: entry.allow,
          configOverride: entry.configOverride ?? {},
        });
      }
    }

    return c.json({ success: true });
  }
);

// GET /agent/tools?agentId=&agentRole=&adapterType=
// Return native platform config for an agent (session auth)
toolsRouter.get("/agent/tools", async (c) => {
  const user = c.get("user");
  const agentId = c.req.query("agentId");
  const agentRole = c.req.query("agentRole");
  const adapterType = c.req.query("adapterType") as AdapterType | undefined;

  if (!agentId || !agentRole || !adapterType) {
    return c.json({ error: "agentId, agentRole, and adapterType are required" }, 400);
  }

  const validAdapters: AdapterType[] = ["claude_code", "codex", "opencode", "http"];
  if (!validAdapters.includes(adapterType)) {
    return c.json({ error: "Invalid adapterType" }, 400);
  }

  const db = getDb();

  // Look up the agent and verify it belongs to a company the user is a member of
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const membership = await getMembership(agent.companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const config = await getAgentToolConfig(agent.companyId, agentId, agentRole, adapterType);
  return c.json(config);
});
