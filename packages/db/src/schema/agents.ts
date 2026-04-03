import { pgTable, text, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  parentAgentId: text("parent_agent_id"),  // self-reference — FK enforced in initAppTables SQL
  name: text("name").notNull(),
  role: text("role").notNull(),
  adapterType: text("adapter_type").notNull().default("http"),  // claude_code | codex | opencode | http
  llmConfig: jsonb("llm_config").notNull().default({}),  // { provider, model }
  adapterConfig: jsonb("adapter_config").default({}),  // { url, reviewPolicy, ... }
  heartbeatCron: text("heartbeat_cron"),
  monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 10, scale: 4 }).default("0"),
  status: text("status").notNull().default("active"),  // active | paused | terminated
  workspacePath: text("workspace_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentApiKeys = pgTable("agent_api_keys", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),  // first 10 chars for display
  scopes: text("scopes").array().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
