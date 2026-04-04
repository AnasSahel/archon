/**
 * Streaming test seed — sets up the "Test Streaming" company with an HTTP
 * echo agent pointing at infra/agent-echo (port 3200).
 *
 * Prerequisites:
 *   1. pnpm db:seed          — creates admin@archon.local
 *   2. pnpm echo:start       — starts the echo agent on port 3200
 *
 * Usage: pnpm db:seed-streaming
 *
 * Idempotent: re-running this script updates the echo agent URL without
 * creating duplicate companies or agents.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, initAppTables, users, companies, companyMembers, agents } from "@archon/db";

const ECHO_AGENT_URL = process.env.ECHO_AGENT_URL ?? "http://localhost:3200/heartbeat";
const TEST_COMPANY_SLUG = "test-streaming";
const ADMIN_EMAIL = "admin@archon.local";

async function main() {
  await initAppTables();
  const db = getDb();

  // Resolve admin user
  const [adminUser] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL));
  if (!adminUser) {
    console.error(`[seed-streaming] Admin user not found (${ADMIN_EMAIL}). Run pnpm db:seed first.`);
    process.exit(1);
  }
  console.log(`[seed-streaming] Admin: ${adminUser.email} (${adminUser.id})`);

  // Upsert "Test Streaming" company
  const [existing] = await db
    .select()
    .from(companies)
    .where(eq(companies.slug, TEST_COMPANY_SLUG));

  let companyId: string;
  if (existing) {
    companyId = existing.id;
    console.log(`[seed-streaming] Company exists: ${existing.name} (${companyId})`);
  } else {
    companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Test Streaming",
      slug: TEST_COMPANY_SLUG,
      mission: "Real-time streaming validation company",
      ownerId: adminUser.id,
    });
    // Add admin as board member
    await db.insert(companyMembers).values({
      id: randomUUID(),
      companyId,
      userId: adminUser.id,
      role: "board",
    });
    console.log(`[seed-streaming] Created company: Test Streaming (${companyId})`);
  }

  // Upsert echo agent
  const [echoAgent] = await db
    .select()
    .from(agents)
    .where(eq(agents.companyId, companyId));

  if (echoAgent) {
    await db
      .update(agents)
      .set({ adapterConfig: { url: ECHO_AGENT_URL } })
      .where(eq(agents.id, echoAgent.id));
    console.log(`[seed-streaming] Updated echo agent URL: ${ECHO_AGENT_URL} (${echoAgent.id})`);
  } else {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Echo Agent",
      role: "engineer",
      adapterType: "http",
      adapterConfig: { url: ECHO_AGENT_URL },
      monthlyBudgetUsd: "10",
    });
    console.log(`[seed-streaming] Created echo agent: ${ECHO_AGENT_URL} (${agentId})`);
  }

  console.log("[seed-streaming] Done.");
  console.log(`[seed-streaming]   Company slug : ${TEST_COMPANY_SLUG}`);
  console.log(`[seed-streaming]   Echo agent   : ${ECHO_AGENT_URL}`);
  console.log("[seed-streaming]   Start echo   : pnpm echo:start");
}

main().catch((err: unknown) => {
  console.error("[seed-streaming] Failed:", err);
  process.exit(1);
});
