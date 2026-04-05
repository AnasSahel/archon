"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/tasks/status-badge";
import { PaginationBar } from "@/components/ui/pagination";

interface Task {
  id: string;
  companyId: string;
  agentId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface PagedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface Agent {
  id: string;
  name: string;
  role: string;
}

interface CompanyInfo {
  id: string;
  name: string;
  userRole: string;
}

interface CreateTaskForm {
  title: string;
  description: string;
  agentId: string;
}

const DEFAULT_FORM: CreateTaskForm = { title: "", description: "", agentId: "" };

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_human", label: "Awaiting human" },
  { value: "escalated", label: "Escalated" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 25;

export default function TasksPage() {
  const { id: companyId } = useParams<{ id: string }>();
  const router = useRouter();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [form, setForm] = useState<CreateTaskForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadTasks = useCallback((p = 1) => {
    if (!companyId) return Promise.resolve();
    const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
    if (statusFilter) params.set("status", statusFilter);
    if (agentFilter) params.set("agentId", agentFilter);
    return apiFetch<PagedResponse<Task>>(`/api/companies/${companyId}/tasks?${params}`)
      .then((res) => {
        setTasks(res.data);
        setTotal(res.total);
        setPage(res.page);
        setPageCount(res.pageCount);
      })
      .catch((err: Error) => setError(err.message));
  }, [companyId, statusFilter, agentFilter]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    Promise.all([
      apiFetch<CompanyInfo>(`/api/companies/${companyId}`),
      apiFetch<PagedResponse<Agent>>(`/api/companies/${companyId}/agents?pageSize=100`),
      apiFetch<PagedResponse<Task>>(`/api/companies/${companyId}/tasks?pageSize=${PAGE_SIZE}`),
    ])
      .then(([comp, agentRes, taskRes]) => {
        setCompany(comp);
        setAgents(agentRes.data);
        setTasks(taskRes.data);
        setTotal(taskRes.total);
        setPage(taskRes.page);
        setPageCount(taskRes.pageCount);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    if (!loading) loadTasks(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, agentFilter]);

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch(`/api/companies/${companyId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          agentId: form.agentId || undefined,
        }),
      });
      setForm(DEFAULT_FORM);
      setShowCreateForm(false);
      await loadTasks(1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create task");
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

  function getAgentName(agentId: string | null): string {
    if (!agentId) return "—";
    const agent = agents.find((a) => a.id === agentId);
    return agent ? agent.name : agentId;
  }

  const awaitingHumanCount = tasks.filter((t) => t.status === "awaiting_human").length;
  const escalatedCount = tasks.filter((t) => t.status === "escalated").length;

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tasks</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total} task{total !== 1 ? "s" : ""}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            {showCreateForm ? "Cancel" : "Create task"}
          </button>
        )}
      </div>

      {/* HITL Review Banner */}
      {(awaitingHumanCount > 0 || escalatedCount > 0) && (
        <div className={`mb-6 rounded-lg border p-4 flex items-center gap-3 ${
          escalatedCount > 0
            ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700"
            : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700"
        }`}>
          <span className="text-lg">{escalatedCount > 0 ? "🔴" : "🟡"}</span>
          <div className="text-sm">
            {escalatedCount > 0 && (
              <span className="font-semibold text-red-700 dark:text-red-300 mr-3">
                {escalatedCount} escalated
              </span>
            )}
            {awaitingHumanCount > 0 && (
              <span className="font-semibold text-amber-700 dark:text-amber-300">
                {awaitingHumanCount} awaiting your review
              </span>
            )}
          </div>
          <button
            onClick={() => setStatusFilter("awaiting_human")}
            className="ml-auto text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline"
          >
            Show pending →
          </button>
        </div>
      )}

      {/* Create Task Form */}
      {showCreateForm && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">New task</h2>
          <form onSubmit={handleCreateTask} className="space-y-4">
            <div>
              <label htmlFor="task-title" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="task-title"
                type="text"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
                placeholder="e.g. Implement authentication flow"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="Optional task description…"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Assign to agent
              </label>
              <select
                value={form.agentId}
                onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.role}
                  </option>
                ))}
              </select>
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
                {submitting ? "Creating…" : "Create task"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreateForm(false); setForm(DEFAULT_FORM); setFormError(null); }}
                className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Task List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {tasks.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No tasks found.</p>
            {canManage && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Create the first task
              </button>
            )}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    onClick={() => router.push(`/companies/${companyId}/tasks/${task.id}`)}
                    className="w-full text-left px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {task.title}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Agent: {getAgentName(task.agentId)} &middot;{" "}
                          {new Date(task.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <StatusBadge status={task.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-6 border-t border-gray-200 dark:border-gray-700">
              <PaginationBar
                page={page}
                pageCount={pageCount}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={(p) => loadTasks(p)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
