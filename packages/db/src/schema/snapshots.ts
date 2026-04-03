import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";

export const agentSnapshots = pgTable("agent_snapshots", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  taskId: text("task_id"),
  heartbeatCount: integer("heartbeat_count").notNull().default(0),
  content: jsonb("content").notNull(),
  tokenEstimate: integer("token_estimate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
