import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, type NotificationEvent } from "@archon/notifications";
import { sessionMiddleware } from "../middleware/session.js";
import { getDb, companyMembers, agents, heartbeats } from "@archon/db";
import { and, eq, inArray, desc } from "drizzle-orm";

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

    // Load agentIds for this company so we can filter events server-side.
    // All NotificationEvent variants carry a required agentId, so we can
    // scope every event to the company without any unsafe fallback paths.
    const companyAgents = await getDb().select({ id: agents.id }).from(agents).where(eq(agents.companyId, companyId));
    const companyAgentIds = new Set(companyAgents.map((a) => a.id));

    function isCompanyEvent(event: NotificationEvent): boolean {
      return companyAgentIds.has(event.agentId);
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

      // Catch-up: replay recent heartbeat state so clients that connect after a
      // heartbeat started (race condition) immediately see the current state.
      if (companyAgentIds.size > 0) {
        const agentIdList = Array.from(companyAgentIds);
        const recentHeartbeats = await getDb()
          .select()
          .from(heartbeats)
          .where(inArray(heartbeats.agentId, agentIdList))
          .orderBy(desc(heartbeats.startedAt))
          .limit(20);

        // Deduplicate: one catch-up event per agent (most recent heartbeat wins)
        const seen = new Set<string>();
        for (const hb of recentHeartbeats) {
          if (seen.has(hb.agentId)) continue;
          seen.add(hb.agentId);

          if (hb.status === "running") {
            // Heartbeat still in progress — tell the UI the agent is active
            await stream.writeSSE({
              event: "heartbeat_started",
              data: JSON.stringify({
                type: "heartbeat_started",
                agentId: hb.agentId,
                ...(hb.taskId ? { taskId: hb.taskId } : {}),
              }),
            }).catch(() => {});
          } else if (hb.status === "completed" || hb.status === "failed") {
            // Heartbeat already finished — send completed event so UI reflects final state
            const costUsd = hb.costUsd ? parseFloat(String(hb.costUsd)) : 0;
            await stream.writeSSE({
              event: "heartbeat_completed",
              data: JSON.stringify({
                type: "heartbeat_completed",
                agentId: hb.agentId,
                status: hb.status,
                costUsd,
              }),
            }).catch(() => {});
          }
        }
      }

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
