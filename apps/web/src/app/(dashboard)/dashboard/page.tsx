"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";

const quickLinks = [
  { href: "/companies", label: "Companies", description: "Manage your virtual companies and teams" },
  { href: "/companies/new", label: "Create Company", description: "Start a new virtual company" },
];

export default function DashboardPage() {
  const { data: session } = authClient.useSession();

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}!
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8">
        Manage your AI agent teams from here.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 transition-colors"
          >
            <p className="font-medium text-gray-900 dark:text-white">{link.label}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{link.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
