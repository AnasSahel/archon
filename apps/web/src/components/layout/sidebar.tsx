"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const globalNavItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/companies", label: "Companies" },
];

function getCompanyNavItems(companyId: string) {
  return [
    { href: `/companies/${companyId}/agents`, label: "Agents" },
    { href: `/companies/${companyId}/tasks`, label: "Tasks" },
    { href: `/companies/${companyId}/settings/members`, label: "Settings" },
  ];
}

function extractCompanyId(pathname: string): string | null {
  const match = pathname.match(/^\/companies\/([^/]+)/);
  return match ? match[1] : null;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();

  const companyId = extractCompanyId(pathname);
  const companyNavItems = companyId ? getCompanyNavItems(companyId) : [];

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
      <div className="px-6 py-5 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xl font-bold text-gray-900 dark:text-white">
          Archon
        </span>
      </div>
      <nav className="flex-1 px-4 py-4 space-y-1">
        {globalNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 ${
              isActive(item.href)
                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        ))}

        <div className="pt-2 pb-1">
          <p className="px-3 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Company
          </p>
        </div>

        {companyNavItems.length > 0 ? (
          companyNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 ${
                isActive(item.href)
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))
        ) : (
          ["Agents", "Tasks", "Settings"].map((label) => (
            <div
              key={label}
              title="Sélectionnez une company"
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-gray-400 dark:text-gray-600 cursor-not-allowed select-none"
            >
              {label}
            </div>
          ))
        )}
      </nav>
      {session?.user && (
        <div className="px-4 py-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium shrink-0">
              {session.user.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {session.user.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {session.user.email}
              </p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white transition-colors duration-150"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
