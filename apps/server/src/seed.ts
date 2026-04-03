/**
 * Seed script — creates the default admin account for local development.
 *
 * Usage: pnpm db:seed
 * Account: admin@archon.local / password123
 */
import "dotenv/config";
import { auth } from "./lib/auth.js";

async function main() {
  console.log("[seed] Creating admin account…");

  const result = await auth.api.signUpEmail({
    body: {
      email: "admin@archon.local",
      password: "password123",
      name: "Admin",
    },
  });

  if (!result?.user) {
    throw new Error("[seed] sign-up did not return a user");
  }

  console.log(`[seed] Admin created: ${result.user.email} (id: ${result.user.id})`);
  console.log("[seed] Done. Login with: admin@archon.local / password123");
}

main().catch((err: unknown) => {
  // If the user already exists, that's fine
  const message = err instanceof Error ? err.message : String(err);
  if (message.toLowerCase().includes("already exists") || message.toLowerCase().includes("unique")) {
    console.log("[seed] Admin account already exists — skipping.");
    process.exit(0);
  }
  console.error("[seed] Failed:", err);
  process.exit(1);
});
