import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, type NotificationEvent } from "@archon/notifications";
import { sessionMiddleware } from "../middleware/session.js";
import { getDb, companyMembers, agents } from "@archon/db";
import { and, eq } from "drizzle-orm";

export const streamRouter = new Hono();

streamRouter.get(
  "/stream/companies/:companyId",
  sessionMiddleware,
  async (c) => {
    const { companyId } = c.req.param();
    const user = c.get("user");

    // Verify user is a member of this company
    const membership = await getDb()
      .select()
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, companyId),
          eq(companyMembers.userId, user.id)
        )
      );

    if (membership.length === 0) {
      return c.json({ error: "Forbidden" }, 403);
    }

    // Load agentIds for this company so we can filter events server-side
    const companyAgents = await getDb().select({ id: agents.id }).from(agents).where(eq(agents.companyId, companyId));
    const companyAgentIds = new Set(companyAgents.map((a) => a.id));

    // Helper: determine if an event belongs to this company
    function isCompanyEvent(event: NotificationEvent): boolean {
      if ("agentId" in event) return companyAgentIds.has(event.agentId);
      if ("taskId" in event) return true; // task events — pass through (tasks are always scoped to company via query)
      return false;
    }

    return streamSSE(c, async (stream) => {
      const unsubscribe = subscribe((event: NotificationEvent) => {
        if (!isCompanyEvent(event)) return;
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        }).catch(() => {
          /* ignore write errors */
        });
      });

      // Keep alive ping every 15s
      const interval = setInterval(() => {
        stream
          .writeSSE({ event: "ping", data: "keep-alive" })
          .catch(() => {});
      }, 15_000);

      // Wait for client disconnect
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });

      clearInterval(interval);
      unsubscribe();
    });
  }
);
