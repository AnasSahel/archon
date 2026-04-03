"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

interface BudgetSummary {
  agentId: string;
  agentName: string;
  agentStatus: string;
  budgetUsd: string;
  spentUsd: string;
  percentUsed: number;
  status: string;
  periodMonth: string;
}

interface CompanyInfo {
  id: string;
  name: string;
  userRole: string;
}

interface Agent {
  id: string;
  name: string;
}

interface SetBudgetForm {
  agentId: string;
  budgetUsd: string;
}

const DEFAULT_SET_FORM: SetBudgetForm = { agentId: "", budgetUsd: "" };

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    paused: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    exceeded: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };
  const style = styles[status] ?? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}

function AgentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    paused: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    terminated: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  };
  const style = styles[status] ?? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const color =
    clamped >= 100
      ? "bg-red-500"
      : clamped >= 80
      ? "bg-orange-500"
      : "bg-green-500";

  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export default function BudgetsPage() {
  const { id: companyId } = useParams<{ id: string }>();
  const [budgets, setBudgets] = useState<BudgetSummary[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSetForm, setShowSetForm] = useState(false);
  const [form, setForm] = useState<SetBudgetForm>(DEFAULT_SET_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const loadBudgets = useCallback(() => {
    if (!companyId) return;
    return apiFetch<BudgetSummary[]>(`/api/companies/${companyId}/budgets`)
      .then(setBudgets)
      .catch((err: Error) => setError(err.message));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      apiFetch<CompanyInfo>(`/api/companies/${companyId}`),
      apiFetch<BudgetSummary[]>(`/api/companies/${companyId}/budgets`),
      apiFetch<Agent[]>(`/api/companies/${companyId}/agents`),
    ])
      .then(([comp, budgetList, agentList]) => {
        setCompany(comp);
        setBudgets(budgetList);
        setAgents(agentList);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  async function handleSetBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId || !form.agentId) return;
    setSubmitting(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      await apiFetch(`/api/companies/${companyId}/agents/${form.agentId}/budget`, {
        method: "PATCH",
        body: JSON.stringify({ budgetUsd: form.budgetUsd }),
      });
      setFormSuccess(`Budget set successfully for agent.`);
      setForm(DEFAULT_SET_FORM);
      setShowSetForm(false);
      await loadBudgets();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to set budget");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-500 dark:text-gray-400">Loading...</p>
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

  const isBoard = company.userRole === "board";
  const periodMonth = budgets[0]?.periodMonth ?? new Date().toISOString().slice(0, 7);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href={`/companies/${companyId}`}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-1 inline-block"
          >
            &larr; {company.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Agent Budgets</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Period: <span className="font-medium">{periodMonth}</span> &mdash; {budgets.length} agent
            {budgets.length !== 1 ? "s" : ""}
          </p>
        </div>
        {isBoard && (
          <button
            onClick={() => {
              setShowSetForm((v) => !v);
              setFormError(null);
              setFormSuccess(null);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            {showSetForm ? "Cancel" : "Set budget"}
          </button>
        )}
      </div>

      {/* Success message */}
      {formSuccess && (
        <div className="mb-4 rounded-md bg-green-50 dark:bg-green-900/20 p-3">
          <p className="text-sm text-green-700 dark:text-green-400">{formSuccess}</p>
        </div>
      )}

      {/* Set Budget Form (board only) */}
      {isBoard && showSetForm && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
            Set monthly budget
          </h2>
          <form onSubmit={handleSetBudget} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Agent <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.agentId}
                  onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
                  required
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select agent...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Budget (USD) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.budgetUsd}
                  onChange={(e) => setForm((f) => ({ ...f, budgetUsd: e.target.value }))}
                  required
                  placeholder="e.g. 50.00"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
              >
                {submitting ? "Saving..." : "Save budget"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSetForm(false);
                  setForm(DEFAULT_SET_FORM);
                  setFormError(null);
                }}
                className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Budget Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {budgets.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No agents found in this company.
            </p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Agent
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Budget (USD)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Spent (USD)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-48">
                  Usage
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Budget status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Agent status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {budgets.map((b) => (
                <tr key={b.agentId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {b.agentName}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {parseFloat(b.budgetUsd) === 0
                        ? "—"
                        : `$${parseFloat(b.budgetUsd).toFixed(2)}`}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      ${parseFloat(b.spentUsd).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <ProgressBar percent={b.percentUsed} />
                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap w-12 text-right">
                        {b.percentUsed.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <AgentStatusBadge status={b.agentStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
