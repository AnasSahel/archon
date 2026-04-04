import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { initAppTables } from "@archon/db";
import { seedSystemTools } from "@archon/tool-policy";
import { startHeartbeatWorker } from "./workers/heartbeat.worker.js";
import { startBudgetCheckWorker } from "./workers/budget-check.worker.js";
import { startHitlEscalationWorker } from "./workers/hitl-escalation.worker.js";
import { startContainerCleanupWorker, scheduleContainerCleanup } from "./workers/container-cleanup.worker.js";
import { startNotificationService } from "./lib/notification-service.js";

const port = Number(process.env.PORT ?? 3010);

async function main() {
  await initAppTables();
  await seedSystemTools();
  startNotificationService();

  // valkey.ts defaults to redis://localhost:6379 when VALKEY_URL is not set,
  // so workers start unconditionally — Redis is expected in dev (infra:up).
  startHeartbeatWorker();
  startBudgetCheckWorker();
  startHitlEscalationWorker();
  startContainerCleanupWorker();
  await scheduleContainerCleanup();
  console.log("[workers] BullMQ workers started (VALKEY_URL=%s)", process.env.VALKEY_URL ?? "redis://localhost:6379 (default)");

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[server] listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("[server] startup error:", err);
  process.exit(1);
});
