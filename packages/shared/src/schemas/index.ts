import { z } from "zod";
import type { TaskPriority, TaskStatus, AgentStatus, Role } from "../types/index.js";

// ─── Common ──────────────────────────────────────────────────────────────────

export const idSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "viewer",
] satisfies [Role, ...Role[]]);

export const agentStatusSchema = z.enum([
  "idle",
  "running",
  "paused",
  "error",
  "terminated",
] satisfies [AgentStatus, ...AgentStatus[]]);

export const taskStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] satisfies [TaskStatus, ...TaskStatus[]]);

export const taskPrioritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
] satisfies [TaskPriority, ...TaskPriority[]]);

// ─── Company ─────────────────────────────────────────────────────────────────

export const createCompanySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
});

// ─── Task ─────────────────────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("medium"),
  assigneeAgentId: idSchema.optional(),
  parentId: idSchema.optional(),
  projectId: idSchema.optional(),
  goalId: idSchema.optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

// ─── Agent ───────────────────────────────────────────────────────────────────

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(50),
  title: z.string().max(100).optional(),
  reportsTo: idSchema.optional(),
  budgetMonthlyCents: z.number().int().min(0).default(0),
});
