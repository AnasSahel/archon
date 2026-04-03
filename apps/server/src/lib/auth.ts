import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, users, sessions, accounts, verifications } from "@archon/db";

const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}

export const auth = betterAuth({
  secret: authSecret ?? "dev-secret-change-in-production-x",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3100",
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      // In dev: log the reset link to the console
      // In production: replace with Resend or another email provider
      if (process.env.NODE_ENV !== "production") {
        console.log(`[Auth] Password reset link for ${user.email}:\n  ${url}`);
      } else {
        console.log(`[Auth] Password reset requested for ${user.email}`);
        // TODO: integrate Resend or SendGrid for production email delivery
      }
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[Auth] Email verification link for ${user.email}:\n  ${url}`);
      } else {
        console.log(`[Auth] Email verification requested for ${user.email}`);
        // TODO: integrate Resend or SendGrid for production email delivery
      }
    },
  },
});

export type Auth = typeof auth;
