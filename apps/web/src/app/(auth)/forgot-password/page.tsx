import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = {
  title: "Reset Password — Archon",
};

export default function ForgotPasswordPage() {
  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-8">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
        Reset your password
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>
      <ForgotPasswordForm />
      <p className="mt-4 text-sm text-center text-gray-600 dark:text-gray-400">
        Remembered it?{" "}
        <Link
          href="/login"
          className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
