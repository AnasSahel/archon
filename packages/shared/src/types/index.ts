// ─── Core domain types ───────────────────────────────────────────────────────

export type Role = "owner" | "admin" | "member" | "viewer";

export type AgentStatus = "idle" | "running" | "paused" | "error" | "terminated";

export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

export type TaskPriority = "critical" | "high" | "medium" | "low";

// ─── Company ─────────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string | null;
  status: AgentStatus;
  reportsTo: string | null;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  parentId: string | null;
  projectId: string | null;
  goalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}
