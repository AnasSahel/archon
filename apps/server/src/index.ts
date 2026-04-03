import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { initAppTables } from "@archon/db";

const port = Number(process.env.PORT ?? 3100);

async function main() {
  await initAppTables();
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[server] listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("[server] startup error:", err);
  process.exit(1);
});
