"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

type CompanyDetail = {
  id: string;
  name: string;
  slug: string;
  mission: string | null;
  memberCount: number;
  userRole: string;
  createdAt: string;
};

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiFetch<CompanyDetail>(`/api/companies/${id}`)
      .then(setCompany)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
        <p className="text-sm text-red-700 dark:text-red-400">{error ?? "Company not found"}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href="/companies"
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-2 inline-block"
          >
            ← Back to companies
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{company.name}</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{company.slug}</p>
        </div>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
          {company.userRole}
        </span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        {company.mission && (
          <div className="p-6">
            <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
              Mission
            </dt>
            <dd className="text-sm text-gray-900 dark:text-white">{company.mission}</dd>
          </div>
        )}

        <div className="p-6">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            Members
          </dt>
          <dd className="text-sm text-gray-900 dark:text-white">{company.memberCount}</dd>
        </div>

        <div className="p-6">
          <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            Created
          </dt>
          <dd className="text-sm text-gray-900 dark:text-white">
            {new Date(company.createdAt).toLocaleDateString()}
          </dd>
        </div>
      </div>

      <div className="mt-4">
        <Link
          href={`/companies/${company.id}/settings/members`}
          className="inline-flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Manage members
        </Link>
      </div>
    </div>
  );
}
