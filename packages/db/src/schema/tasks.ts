import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  parentTaskId: text("parent_task_id"),  // self-ref — added via SQL in initAppTables
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),  // open | in_progress | awaiting_human | escalated | done | cancelled
  hitlState: jsonb("hitl_state"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedReason: text("locked_reason"),
  reviewRequiredBy: timestamp("review_required_by", { withTimezone: true }),
  goalContext: jsonb("goal_context"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const taskComments = pgTable("task_comments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  authorType: text("author_type").notNull(),  // human | agent
  authorId: text("author_id").notNull(),
  content: text("content").notNull(),
  commentType: text("comment_type").notNull().default("message"),  // message | review_request | approve | reject | escalate | snapshot
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actorType: text("actor_type").notNull(),  // human | agent | system
  actorId: text("actor_id").notNull(),
  diff: jsonb("diff"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
