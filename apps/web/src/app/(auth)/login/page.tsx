import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = {
  title: "Sign In — Archon",
};

export default function LoginPage() {
  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-8">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
        Sign in to your account
      </h2>
      <LoginForm />
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link
          href="/forgot-password"
          className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Forgot your password?
        </Link>
        <Link
          href="/register"
          className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}
