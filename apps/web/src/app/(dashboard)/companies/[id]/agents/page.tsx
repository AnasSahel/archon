"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { OrgChart } from "@/components/agents/org-chart";
import { AgentDetailPanel } from "@/components/agents/agent-detail-panel";
import type { AgentNode } from "@/components/agents/org-chart";

interface FullAgent extends AgentNode {
  companyId: string;
  llmConfig: { provider: string; model: string } | null;
  monthlyBudgetUsd: string | null;
  workspacePath: string | null;
  heartbeatCron: string | null;
  createdAt: string;
}

interface CompanyInfo {
  id: string;
  name: string;
  userRole: string;
}

interface CreateAgentForm {
  name: string;
  role: string;
  parentAgentId: string;
  adapterType: "claude_code" | "codex" | "opencode" | "http";
  llmProvider: string;
  llmModel: string;
}

const DEFAULT_FORM: CreateAgentForm = {
  name: "",
  role: "",
  parentAgentId: "",
  adapterType: "http",
  llmProvider: "anthropic",
  llmModel: "claude-opus-4-5",
};

export default function AgentsPage() {
  const { id: companyId } = useParams<{ id: string }>();
  const [agents, setAgents] = useState<FullAgent[]>([]);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<CreateAgentForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const loadAgents = useCallback(() => {
    if (!companyId) return;
    return apiFetch<{ data: FullAgent[] }>(`/api/companies/${companyId}/agents?pageSize=100`)
      .then((res) => setAgents(res.data))
      .catch((err) => setError(err.message));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      apiFetch<CompanyInfo>(`/api/companies/${companyId}`),
      apiFetch<{ data: FullAgent[] }>(`/api/companies/${companyId}/agents?pageSize=100`),
    ])
      .then(([comp, agentRes]) => {
        setCompany(comp);
        setAgents(agentRes.data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  async function handleCreateAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch(`/api/companies/${companyId}/agents`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          parentAgentId: form.parentAgentId || undefined,
          adapterType: form.adapterType,
          llmConfig: { provider: form.llmProvider, model: form.llmModel },
        }),
      });
      setForm(DEFAULT_FORM);
      setShowAddForm(false);
      await loadAgents();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSubmitting(false);
    }
  }

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

  const canManage = company.userRole === "board" || company.userRole === "manager";

  return (
    <div className="relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href={`/companies/${companyId}`}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-1 inline-block"
          >
            ← {company.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Agents</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {agents.length} agent{agents.length !== 1 ? "s" : ""} in this company
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            {showAddForm ? "Cancel" : "Add agent"}
          </button>
        )}
      </div>

      {/* Add Agent Form */}
      {showAddForm && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">New agent</h2>
          <form onSubmit={handleCreateAgent} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="e.g. Engineering Lead"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Role <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  required
                  placeholder="e.g. Software Engineer"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Parent agent
                </label>
                <select
                  value={form.parentAgentId}
                  onChange={(e) => setForm((f) => ({ ...f, parentAgentId: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">None (root agent)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Adapter type
                </label>
                <select
                  value={form.adapterType}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      adapterType: e.target.value as CreateAgentForm["adapterType"],
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="http">HTTP</option>
                  <option value="claude_code">Claude Code</option>
                  <option value="codex">Codex</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  LLM provider
                </label>
                <input
                  type="text"
                  value={form.llmProvider}
                  onChange={(e) => setForm((f) => ({ ...f, llmProvider: e.target.value }))}
                  placeholder="anthropic"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  LLM model
                </label>
                <input
                  type="text"
                  value={form.llmModel}
                  onChange={(e) => setForm((f) => ({ ...f, llmModel: e.target.value }))}
                  placeholder="claude-opus-4-5"
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
                {submitting ? "Creating…" : "Create agent"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setForm(DEFAULT_FORM);
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

      {/* Org Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <OrgChart
          agents={agents}
          onSelect={(id) => setSelectedAgentId((prev) => (prev === id ? null : id))}
          selectedId={selectedAgentId}
        />
      </div>

      {/* Agent Detail Side Panel */}
      {selectedAgent && (
        <>
          {/* Backdrop overlay for mobile */}
          <div
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-30 lg:hidden"
            onClick={() => setSelectedAgentId(null)}
          />
          <AgentDetailPanel
            agent={selectedAgent}
            companyId={companyId}
            userRole={company.userRole}
            onClose={() => setSelectedAgentId(null)}
            onAgentUpdated={() => {
              loadAgents();
            }}
          />
        </>
      )}
    </div>
  );
}
