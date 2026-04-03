import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { initAppTables } from "@archon/db";
import { startHeartbeatWorker } from "./workers/heartbeat.worker.js";
import { startBudgetCheckWorker } from "./workers/budget-check.worker.js";

const port = Number(process.env.PORT ?? 3100);

async function main() {
  await initAppTables();

  const valKeyUrl = process.env.VALKEY_URL;
  if (valKeyUrl) {
    startHeartbeatWorker();
    startBudgetCheckWorker();
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
