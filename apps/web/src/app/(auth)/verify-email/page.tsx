import { Suspense } from "react";
import Link from "next/link";
import { VerifyEmailHandler } from "@/components/auth/verify-email-handler";

export const metadata = {
  title: "Verify Email — Archon",
};

export default function VerifyEmailPage() {
  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-8">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        Email verification
      </h2>
      <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
        <VerifyEmailHandler />
      </Suspense>
      <p className="mt-4 text-sm text-center text-gray-600 dark:text-gray-400">
        <Link
          href="/login"
          className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
