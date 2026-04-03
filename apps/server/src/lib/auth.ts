import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, users, sessions, accounts, verifications } from "@archon/db";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-in-production",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3010",
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
      console.log(
        `[Auth] Password reset link for ${user.email}:\n  ${url}`
      );
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      console.log(
        `[Auth] Email verification link for ${user.email}:\n  ${url}`
      );
    },
  },
});

export type Auth = typeof auth;
