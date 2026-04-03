/**
 * Migration runner.
 * Phase 1: PGlite only — skips migration if DATABASE_URL is unset.
 * Phase 2+: add drizzle-orm/node-postgres + pg to run against real Postgres.
 */
async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.log("[db] DATABASE_URL not set — skipping migration (PGlite mode)");
    return;
  }
  console.log("[db] DATABASE_URL set — real Postgres migration not yet implemented (Phase 2)");
}

main().catch((err: unknown) => {
  console.error("[db] migration failed:", err);
  process.exit(1);
});
