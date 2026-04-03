import { pgTable, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";

export const agentBudgets = pgTable("agent_budgets", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  periodMonth: text("period_month").notNull(),  // "2026-04"
  budgetUsd: numeric("budget_usd", { precision: 10, scale: 4 }).notNull(),
  spentUsd: numeric("spent_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  status: text("status").notNull().default("active"),  // active | paused | exceeded
  pausedAt: timestamp("paused_at", { withTimezone: true }),
});

export const heartbeats = pgTable("heartbeats", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  taskId: text("task_id"),
  status: text("status").notNull(),  // running | completed | failed | timeout
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).default("0"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
