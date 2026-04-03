import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, type NotificationEvent } from "@archon/notifications";
import { sessionMiddleware } from "../middleware/session.js";
import { getDb, companyMembers } from "@archon/db";
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

    return streamSSE(c, async (stream) => {
      const unsubscribe = subscribe((event: NotificationEvent) => {
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
