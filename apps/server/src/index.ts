import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { initAppTables } from "@archon/db";
import { seedSystemTools } from "@archon/tool-policy";
import { startHeartbeatWorker } from "./workers/heartbeat.worker.js";
import { startBudgetCheckWorker } from "./workers/budget-check.worker.js";
import { startHitlEscalationWorker } from "./workers/hitl-escalation.worker.js";

const port = Number(process.env.PORT ?? 3010);

async function main() {
  await initAppTables();
  await seedSystemTools();

  const valKeyUrl = process.env.VALKEY_URL;
  if (valKeyUrl) {
    startHeartbeatWorker();
    startBudgetCheckWorker();
    startHitlEscalationWorker();
    console.log("[workers] BullMQ workers started");
  } else {
    console.log("[workers] VALKEY_URL not set — BullMQ workers disabled");
  }

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[server] listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("[server] startup error:", err);
  process.exit(1);
});
