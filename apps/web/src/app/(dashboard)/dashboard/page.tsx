"use client";

import { authClient } from "@/lib/auth-client";

export default function DashboardPage() {
  const { data: session } = authClient.useSession();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}!
      </h1>
      <p className="text-gray-500 dark:text-gray-400">
        Your AI agent orchestration platform is ready. Use the sidebar to manage
        companies, agents, and tasks.
      </p>
    </div>
  );
}
