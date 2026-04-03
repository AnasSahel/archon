import Link from "next/link";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = {
  title: "Set New Password — Archon",
};

export default function ResetPasswordPage() {
  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-8">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Set a new password
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Choose a strong password for your account.
      </p>
      <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
        <ResetPasswordForm />
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
