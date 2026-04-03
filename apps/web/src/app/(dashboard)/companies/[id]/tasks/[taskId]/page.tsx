"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/tasks/status-badge";

interface Comment {
  id: string;
  taskId: string;
  authorType: string;
  authorId: string;
  content: string;
  commentType: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface TaskDetail {
  id: string;
  companyId: string;
  agentId: string | null;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: string;
  lockedAt: string | null;
  lockedReason: string | null;
  reviewRequiredBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  comments: Comment[];
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

const STATUS_OPTIONS = [
  "open",
  "in_progress",
  "awaiting_human",
  "escalated",
  "done",
  "cancelled",
] as const;

const COMMENT_TYPE_STYLES: Record<string, string> = {
  message: "bg-gray-100 text-gray-600",
  review_request: "bg-yellow-100 text-yellow-700",
  approve: "bg-green-100 text-green-700",
  reject: "bg-red-100 text-red-700",
  escalate: "bg-orange-100 text-orange-700",
  snapshot: "bg-purple-100 text-purple-700",
};

export default function TaskDetailPage() {
  const { id: companyId, taskId } = useParams<{ id: string; taskId: string }>();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const [changingStatus, setChangingStatus] = useState(false);

  const [hitlAction, setHitlAction] = useState<"approve" | "reject" | "comment" | "escalate" | null>(null);
  const [hitlFeedback, setHitlFeedback] = useState("");
  const [submittingHitl, setSubmittingHitl] = useState(false);
  const [hitlError, setHitlError] = useState<string | null>(null);

  const loadTask = useCallback(() => {
    if (!companyId || !taskId) return Promise.resolve();
    return apiFetch<TaskDetail>(`/api/companies/${companyId}/tasks/${taskId}`)
      .then(setTask)
      .catch((err: Error) => setError(err.message));
  }, [companyId, taskId]);

  useEffect(() => {
    if (!companyId || !taskId) return;
    setLoading(true);
    Promise.all([
      apiFetch<CompanyInfo>(`/api/companies/${companyId}`),
      apiFetch<Agent[]>(`/api/companies/${companyId}/agents`),
      apiFetch<TaskDetail>(`/api/companies/${companyId}/tasks/${taskId}`),
    ])
      .then(([comp, agentList, taskData]) => {
        setCompany(comp);
        setAgents(agentList);
        setTask(taskData);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId, taskId]);

  async function handleStatusChange(newStatus: string) {
    if (!companyId || !taskId || !task) return;
    setChangingStatus(true);
    try {
      await apiFetch(`/api/companies/${companyId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      await loadTask();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setChangingStatus(false);
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId || !taskId || !commentText.trim()) return;
    setSubmittingComment(true);
    setCommentError(null);
    try {
      await apiFetch(`/api/companies/${companyId}/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: commentText.trim() }),
      });
      setCommentText("");
      await loadTask();
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Failed to add comment");
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleHitlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId || !taskId || !hitlAction) return;
    setSubmittingHitl(true);
    setHitlError(null);
    try {
      await apiFetch(`/api/companies/${companyId}/tasks/${taskId}/review`, {
        method: "POST",
        body: JSON.stringify({
          action: hitlAction,
          feedback: hitlFeedback.trim() || undefined,
        }),
      });
      setHitlAction(null);
      setHitlFeedback("");
      await loadTask();
    } catch (err) {
      setHitlError(err instanceof Error ? err.message : "Failed to submit review");
    } finally {
      setSubmittingHitl(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-500 dark:text-gray-400">Loading…</p>
      </div>
    );
  }

  if (error || !task || !company) {
    return (
      <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
        <p className="text-sm text-red-700 dark:text-red-400">{error ?? "Task not found"}</p>
      </div>
    );
  }

  const canManage = company.userRole === "board" || company.userRole === "manager";
  const isBoard = company.userRole === "board";
  const assignedAgent = agents.find((a) => a.id === task.agentId) ?? null;
  const needsHitlReview = task.status === "awaiting_human" || task.status === "escalated";

  return (
    <div className="max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-6">
        <Link
          href={`/companies/${companyId}`}
          className="text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {company.name}
        </Link>
        <span>/</span>
        <Link
          href={`/companies/${companyId}/tasks`}
          className="text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          Tasks
        </Link>
        <span>/</span>
        <span className="truncate max-w-xs">{task.title}</span>
      </div>

      {/* Task Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-snug">
            {task.title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={task.status} />
            {canManage && (
              <select
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                disabled={changingStatus}
                className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Assigned agent: </span>
            {assignedAgent ? (
              <span>
                {assignedAgent.name}{" "}
                <span className="text-xs text-gray-400">({assignedAgent.role})</span>
              </span>
            ) : (
              <span>Unassigned</span>
            )}
          </div>
          <div>
            <span className="font-medium text-gray-700 dark:text-gray-300">Created: </span>
            {new Date(task.createdAt).toLocaleString()}
          </div>
          {task.completedAt && (
            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Completed: </span>
              {new Date(task.completedAt).toLocaleString()}
            </div>
          )}
        </div>

        {task.description && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Description
            </h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {task.description}
            </p>
          </div>
        )}
      </div>

      {/* HITL Action Panel */}
      {needsHitlReview && isBoard && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700 p-6 mb-4">
          <div className="flex items-start gap-3 mb-4">
            <div className="shrink-0 w-8 h-8 bg-amber-100 dark:bg-amber-800 rounded-full flex items-center justify-center">
              <span className="text-amber-600 dark:text-amber-300 text-sm font-bold">!</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                {task.status === "escalated" ? "Escalated — Urgent Review Required" : "This task is awaiting your review"}
              </h2>
              {task.reviewRequiredBy && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  Review deadline: {new Date(task.reviewRequiredBy).toLocaleString()}
                </p>
              )}
              {task.lockedReason && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  {task.lockedReason}
                </p>
              )}
            </div>
          </div>

          {hitlAction === null ? (
            <div className="flex gap-2">
              <button
                onClick={() => setHitlAction("approve")}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => setHitlAction("reject")}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors"
              >
                Reject
              </button>
              <button
                onClick={() => setHitlAction("comment")}
                className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                Comment
              </button>
              <button
                onClick={() => setHitlAction("escalate")}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-md transition-colors"
              >
                Escalate
              </button>
            </div>
          ) : (
            <form onSubmit={handleHitlSubmit} className="space-y-3">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100 capitalize">
                {hitlAction === "approve"
                  ? "Approve this task"
                  : hitlAction === "reject"
                  ? "Reject this task"
                  : hitlAction === "escalate"
                  ? "Escalate this task"
                  : "Add a comment"}
              </p>
              {(hitlAction === "reject" || hitlAction === "comment" || hitlAction === "escalate") && (
                <textarea
                  value={hitlFeedback}
                  onChange={(e) => setHitlFeedback(e.target.value)}
                  rows={3}
                  required={hitlAction === "comment"}
                  placeholder={
                    hitlAction === "reject"
                      ? "Optional: explain why you're rejecting…"
                      : hitlAction === "escalate"
                      ? "Optional: reason for escalation…"
                      : "Your comment for the agent…"
                  }
                  className="w-full px-3 py-2 text-sm border border-amber-300 dark:border-amber-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              )}
              {hitlError && (
                <p className="text-sm text-red-600 dark:text-red-400">{hitlError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={submittingHitl}
                  className={`px-4 py-2 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 ${
                    hitlAction === "approve"
                      ? "bg-green-600 hover:bg-green-700"
                      : hitlAction === "reject"
                      ? "bg-red-600 hover:bg-red-700"
                      : hitlAction === "escalate"
                      ? "bg-orange-600 hover:bg-orange-700"
                      : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {submittingHitl ? "Submitting…" : `Confirm ${hitlAction}`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHitlAction(null);
                    setHitlFeedback("");
                    setHitlError(null);
                  }}
                  className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Comment Thread */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
          Comments ({task.comments.length})
        </h2>

        {task.comments.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">No comments yet.</p>
        ) : (
          <ul className="space-y-4 mb-6">
            {task.comments.map((comment) => {
              const typeStyle =
                COMMENT_TYPE_STYLES[comment.commentType] ?? COMMENT_TYPE_STYLES.message;
              return (
                <li
                  key={comment.id}
                  className="flex gap-3 pb-4 border-b border-gray-100 dark:border-gray-700 last:border-0 last:pb-0"
                >
                  <div className="mt-0.5 text-lg shrink-0">
                    {comment.authorType === "agent" ? "🤖" : "👤"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {comment.authorId}
                      </span>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${typeStyle}`}
                      >
                        {comment.commentType.replace("_", " ")}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(comment.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Comment Form */}
        <form onSubmit={handleAddComment} className="space-y-3">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            rows={3}
            placeholder="Add a comment…"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
          {commentError && (
            <p className="text-sm text-red-600 dark:text-red-400">{commentError}</p>
          )}
          <button
            type="submit"
            disabled={submittingComment || !commentText.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
          >
            {submittingComment ? "Posting…" : "Post comment"}
          </button>
        </form>
      </div>
    </div>
  );
}
