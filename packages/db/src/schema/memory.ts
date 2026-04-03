import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";

export const agentMemory = pgTable("agent_memory", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  // embedding stored as raw JSON array (pgvector type not mapped in Drizzle schema layer)
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
