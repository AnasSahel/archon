import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Resend } from "resend";
import { getDb, users, sessions, accounts, verifications } from "@archon/db";

const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? "Archon <noreply@archon.app>";

async function sendEmail(to: string, subject: string, html: string) {
  if (resend) {
    await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  } else {
    // Dev fallback: log to console
    console.log(`[Auth] Email to ${to} — ${subject}`);
  }
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
      if (!resend) {
        console.log(`[Auth] Password reset link for ${user.email}:\n  ${url}`);
        return;
      }
      await sendEmail(
        user.email,
        "Reset your Archon password",
        `<p>Click the link below to reset your password. This link expires in 1 hour.</p>
<p><a href="${url}">${url}</a></p>
<p>If you did not request a password reset, ignore this email.</p>`
      );
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      if (!resend) {
        console.log(
          `[Auth] Email verification link for ${user.email}:\n  ${url}`
        );
        return;
      }
      await sendEmail(
        user.email,
        "Verify your Archon email address",
        `<p>Click the link below to verify your email address.</p>
<p><a href="${url}">${url}</a></p>
<p>If you did not create an Archon account, ignore this email.</p>`
      );
    },
  },
});

export type Auth = typeof auth;
