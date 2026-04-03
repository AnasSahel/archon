import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { healthRouter } from "./routes/health.js";
import { companiesRouter } from "./routes/companies.js";
import { agentsRouter } from "./routes/agents.js";
import { tasksRouter } from "./routes/tasks.js";
import { budgetsRouter } from "./routes/budgets.js";
import { snapshotRouter } from "./routes/snapshot.js";
import { auth } from "./lib/auth.js";

export const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.PLATFORM_URL ?? "http://localhost:3000",
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// Auth routes (Better Auth handler)
app.on(["GET", "POST"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

// Routes
app.route("/api", healthRouter);
app.route("/api", companiesRouter);
app.route("/api", agentsRouter);
app.route("/api", tasksRouter);
app.route("/api", budgetsRouter);
app.route("/api", snapshotRouter);

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("[server] unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
