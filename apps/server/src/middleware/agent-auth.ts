import { createMiddleware } from "hono/factory";
import { createHash } from "node:crypto";
import { getDb, agentApiKeys, agents } from "@archon/db";
import { eq, and, isNull, or, gt } from "drizzle-orm";

export type AgentContext = {
  id: string;
  companyId: string;
  name: string;
  role: string;
};

declare module "hono" {
  interface ContextVariableMap {
    agentContext: AgentContext;
  }
}

export const agentAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer pf_")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const raw = authHeader.slice(7); // strip "Bearer "
  const hash = createHash("sha256").update(raw).digest("hex");
  const now = new Date();
  const db = getDb();

  const [key] = await db
    .select()
    .from(agentApiKeys)
    .where(
      and(
        eq(agentApiKeys.keyHash, hash),
        isNull(agentApiKeys.revokedAt),
        or(isNull(agentApiKeys.expiresAt), gt(agentApiKeys.expiresAt, now))
      )
    );

  if (!key) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Update last-used timestamp (fire-and-forget)
  db.update(agentApiKeys)
    .set({ lastUsedAt: now })
    .where(eq(agentApiKeys.id, key.id))
    .catch(() => {});

  const [agent] = await db.select().from(agents).where(eq(agents.id, key.agentId));
  if (!agent) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("agentContext", {
    id: agent.id,
    companyId: agent.companyId,
    name: agent.name,
    role: agent.role,
  });

  return next();
});
