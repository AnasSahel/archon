"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Crumb = {
  label: string;
  href?: string;
};

const PAGE_LABELS: Record<string, string> = {
  agents: "Agents",
  tasks: "Tasks",
  settings: "Settings",
  members: "Members",
  budgets: "Budgets",
  new: "New",
};

export function Breadcrumb() {
  const pathname = usePathname();
  const [companyName, setCompanyName] = useState<string | null>(null);

  const match = pathname.match(/^\/companies\/([^/]+)(.*)/);
  const companyId = match ? (match[1] ?? null) : null;
  const rest: string = match ? (match[2] ?? "") : "";

  useEffect(() => {
    if (!companyId || companyId === "new") return;
    apiFetch<{ name: string }>(`/api/companies/${companyId}`)
      .then((c) => setCompanyName(c.name))
      .catch(() => setCompanyName(companyId));
  }, [companyId]);

  if (!companyId) return null;

  const crumbs: Crumb[] = [
    { label: "Companies", href: "/companies" },
  ];

  if (companyId === "new") {
    crumbs.push({ label: "New Company" });
  } else {
    crumbs.push({
      label: companyName ?? companyId,
      href: `/companies/${companyId}`,
    });

    const segments = rest.split("/").filter(Boolean);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as string;
      const label = PAGE_LABELS[seg] ?? seg;
      const isLast = i === segments.length - 1;
      if (isLast) {
        crumbs.push({ label });
      } else {
        crumbs.push({ label, href: `/companies/${companyId}/${segments.slice(0, i + 1).join("/")}` });
      }
    }
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-6">
      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-400 dark:text-gray-600">/</span>}
          {crumb.href ? (
            <Link
              href={crumb.href}
              className="hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="text-gray-900 dark:text-white font-medium">
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
