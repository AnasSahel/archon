import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

// agent_memory stores both periodic snapshots (type='snapshot') and
// individual memory entries (type='memory') for semantic search via pgvector.
export const agentMemory = pgTable("agent_memory", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("snapshot"), // 'snapshot' | 'memory'
  content: text("content").notNull(),
  heartbeatCount: integer("heartbeat_count").notNull().default(0),
  // embedding stored via raw pgvector SQL (not mapped in Drizzle schema layer)
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
