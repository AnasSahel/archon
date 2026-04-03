import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const toolRegistry = pgTable("tool_registry", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(),  // mcp | skill | command | web
  description: text("description"),
  platforms: text("platforms").array().notNull().default([]),  // claude_code | codex | opencode | http
  configSchema: jsonb("config_schema").default({}),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const toolPermissions = pgTable("tool_permissions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentRole: text("agent_role"),  // null = all roles
  agentId: text("agent_id").references(() => agents.id, { onDelete: "cascade" }),  // null = by role
  toolId: text("tool_id").notNull().references(() => toolRegistry.id, { onDelete: "cascade" }),
  allow: boolean("allow").notNull().default(true),
  configOverride: jsonb("config_override").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
