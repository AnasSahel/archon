"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Member = {
  id: string;
  userId: string;
  role: string;
  name: string | null;
  email: string;
  joinedAt: string;
};

const ROLES = ["board", "manager", "observer", "auditor"] as const;
type Role = (typeof ROLES)[number];

export default function MembersPage() {
  const { id } = useParams<{ id: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("observer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  async function loadData() {
    if (!id) return;
    try {
      const [membersData, companyData] = await Promise.all([
        apiFetch<Member[]>(`/api/companies/${id}/members`),
        apiFetch<{ userRole: string }>(`/api/companies/${id}`),
      ]);
      setMembers(membersData);
      setUserRole(companyData.userRole);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [id]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setInviting(true);
    setInviteError(null);
    try {
      await apiFetch(`/api/companies/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteEmail("");
      setInviteRole("observer");
      await loadData();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  }

  async function handleChangeRole(userId: string, role: Role) {
    if (!id) return;
    try {
      await apiFetch(`/api/companies/${id}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to change role");
    }
  }

  async function handleRemove(userId: string) {
    if (!id || !confirm("Remove this member?")) return;
    try {
      await apiFetch(`/api/companies/${id}/members/${userId}`, {
        method: "DELETE",
      });
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  const isBoard = userRole === "board";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link
          href={`/companies/${id}`}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-2 inline-block"
        >
          ← Back to company
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Members</h1>
      </div>

      {/* Members table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Name / Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Role
              </th>
              {isBoard && (
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {members.map((member) => (
              <tr key={member.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900 dark:text-white">
                    {member.name ?? member.email}
                  </p>
                  {member.name && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">{member.email}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {isBoard ? (
                    <select
                      value={member.role}
                      onChange={(e) => handleChangeRole(member.userId, e.target.value as Role)}
                      className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs px-2 py-1 text-gray-900 dark:text-white"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                      {member.role}
                    </span>
                  )}
                </td>
                {isBoard && (
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemove(member.userId)}
                      className="text-xs text-red-600 dark:text-red-400 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invite form — board only */}
      {isBoard && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Invite member
          </h2>
          {inviteError && (
            <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/20 p-3">
              <p className="text-sm text-red-700 dark:text-red-400">{inviteError}</p>
            </div>
          )}
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="flex-1">
              <label
                htmlFor="email"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                placeholder="user@example.com"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label
                htmlFor="role"
                className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Role
              </label>
              <select
                id="role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {inviting ? "Inviting…" : "Invite"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
