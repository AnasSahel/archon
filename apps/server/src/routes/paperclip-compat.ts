/**
 * Paperclip-compatible API endpoints for agent authentication.
 *
 * Agents running in heartbeat containers authenticate with their Bearer pf_...
 * key and use these endpoints to read tasks, post comments, and update status —
 * the same interaction pattern as the real Paperclip control plane.
 *
 * Status mapping (Archon ↔ Paperclip):
 *   open            ↔ todo
 *   in_progress     ↔ in_progress
 *   awaiting_human  ↔ in_review
 *   escalated       ↔ blocked
 *   done            ↔ done
 *   cancelled       ↔ cancelled
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { eq, and, inArray, desc } from "drizzle-orm";
import { getDb, tasks, taskComments, agents } from "@archon/db";
import { agentAuthMiddleware } from "../middleware/agent-auth.js";

export const paperclipCompatRouter = new Hono();

// Apply agent auth to all routes in this router
paperclipCompatRouter.use("*", agentAuthMiddleware);

// ── Status helpers ──────────────────────────────────────────────────────────

type ArchonStatus = "open" | "in_progress" | "awaiting_human" | "escalated" | "done" | "cancelled";
type PaperclipStatus = "todo" | "backlog" | "in_progress" | "in_review" | "blocked" | "done" | "cancelled";

function archonToPaperclip(status: string): PaperclipStatus {
  const map: Record<string, PaperclipStatus> = {
    open: "todo",
    in_progress: "in_progress",
    awaiting_human: "in_review",
    escalated: "blocked",
    done: "done",
    cancelled: "cancelled",
  };
  return map[status] ?? "todo";
}

function paperclipToArchon(status: string): ArchonStatus {
  const map: Record<string, ArchonStatus> = {
    todo: "open",
    backlog: "open",
    in_progress: "in_progress",
    in_review: "awaiting_human",
    blocked: "escalated",
    done: "done",
    cancelled: "cancelled",
  };
  return map[status] ?? "open";
}

// ── Task → Issue shape ───────────────────────────────────────────────────────

type TaskRow = typeof tasks.$inferSelect;
type CommentRow = typeof taskComments.$inferSelect;

function taskToIssue(task: TaskRow) {
  return {
    id: task.id,
    companyId: task.companyId,
    projectId: null,
    goalId: null,
    parentId: task.parentTaskId ?? null,
    title: task.title,
    description: task.description ?? null,
    status: archonToPaperclip(task.status),
    priority: "medium",
    assigneeAgentId: task.agentId ?? null,
    assigneeUserId: null,
    createdByAgentId: null,
    createdByUserId: task.createdBy ?? null,
    issueNumber: null,
    identifier: task.id,
    updatedAt: task.updatedAt.toISOString(),
    createdAt: task.createdAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

function commentToIssueComment(c: CommentRow) {
  return {
    id: c.id,
    issueId: c.taskId,
    companyId: null,
    authorAgentId: c.authorType === "agent" ? c.authorId : null,
    authorUserId: c.authorType === "human" ? c.authorId : null,
    body: c.content,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.createdAt.toISOString(),
  };
}

// ── GET /api/agents/me ────────────────────────────────────────────────────

paperclipCompatRouter.get("/agents/me", async (c) => {
  const agent = c.get("agentContext");
  return c.json({
    id: agent.id,
    companyId: agent.companyId,
    name: agent.name,
    role: agent.role,
    chainOfCommand: [],
    budget: null,
  });
});

// ── GET /api/agents/me/inbox-lite ─────────────────────────────────────────

paperclipCompatRouter.get("/agents/me/inbox-lite", async (c) => {
  const agent = c.get("agentContext");
  const db = getDb();

  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.agentId, agent.id),
        inArray(tasks.status, ["open", "in_progress", "escalated"])
      )
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(50);

  return c.json(rows.map((t) => ({
    id: t.id,
    identifier: t.id,
    title: t.title,
    status: archonToPaperclip(t.status),
    priority: "medium",
    projectId: null,
    goalId: null,
    parentId: t.parentTaskId ?? null,
    updatedAt: t.updatedAt.toISOString(),
    activeRun: null,
  })));
});

// ── POST /api/issues/:issueId/checkout ───────────────────────────────────

paperclipCompatRouter.post("/issues/:issueId/checkout", async (c) => {
  const agent = c.get("agentContext");
  const { issueId } = c.req.param();
  const db = getDb();

  let body: { agentId?: string; expectedStatuses?: string[] } = {};
  try {
    body = await c.req.json() as typeof body;
  } catch {
    // body is optional
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, issueId), eq(tasks.companyId, agent.companyId)));

  if (!task) return c.json({ error: "Not found" }, 404);

  // Verify task is assigned to this agent
  if (task.agentId && task.agentId !== agent.id) {
    return c.json({ error: "Conflict — task owned by another agent" }, 409);
  }

  // Check expected status (map from Paperclip → Archon)
  if (body.expectedStatuses && body.expectedStatuses.length > 0) {
    const allowed = body.expectedStatuses.map(paperclipToArchon);
    // Also allow in_progress if already checked out by same agent
    if (!allowed.includes(task.status as ArchonStatus) && task.status !== "in_progress") {
      return c.json(
        { error: `Conflict — task status is '${task.status}', expected one of [${body.expectedStatuses.join(", ")}]` },
        409
      );
    }
  }

  // Mark in_progress
  await db
    .update(tasks)
    .set({ status: "in_progress", agentId: agent.id, updatedAt: new Date() })
    .where(eq(tasks.id, issueId));

  const [updated] = await db.select().from(tasks).where(eq(tasks.id, issueId));
  return c.json(taskToIssue(updated!));
});

// ── GET /api/issues/:issueId ─────────────────────────────────────────────

paperclipCompatRouter.get("/issues/:issueId", async (c) => {
  const agent = c.get("agentContext");
  const { issueId } = c.req.param();
  const db = getDb();

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, issueId), eq(tasks.companyId, agent.companyId)));

  if (!task) return c.json({ error: "Not found" }, 404);

  return c.json(taskToIssue(task));
});

// ── GET /api/issues/:issueId/heartbeat-context ───────────────────────────

paperclipCompatRouter.get("/issues/:issueId/heartbeat-context", async (c) => {
  const agent = c.get("agentContext");
  const { issueId } = c.req.param();
  const db = getDb();

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, issueId), eq(tasks.companyId, agent.companyId)));

  if (!task) return c.json({ error: "Not found" }, 404);

  const comments = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, issueId))
    .orderBy(desc(taskComments.createdAt))
    .limit(1);

  const latest = comments[0];

  return c.json({
    issue: taskToIssue(task),
    ancestors: [],
    project: null,
    goal: null,
    commentCursor: {
      totalComments: null,
      latestCommentId: latest?.id ?? null,
      latestCommentAt: latest?.createdAt.toISOString() ?? null,
    },
    wakeComment: null,
  });
});

// ── GET /api/issues/:issueId/comments ────────────────────────────────────

paperclipCompatRouter.get("/issues/:issueId/comments", async (c) => {
  const agent = c.get("agentContext");
  const { issueId } = c.req.param();
  const { after, order } = c.req.query();
  const db = getDb();

  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, issueId), eq(tasks.companyId, agent.companyId)));

  if (!task) return c.json({ error: "Not found" }, 404);

  const rows = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, issueId))
    .orderBy(order === "asc" ? taskComments.createdAt : desc(taskComments.createdAt));

  const mapped = rows.map(commentToIssueComment);

  // Apply after-cursor filter client-side (simple sequential IDs not guaranteed ordered)
  if (after) {
    const idx = mapped.findIndex((c) => c.id === after);
    return c.json(idx >= 0 ? mapped.slice(idx + 1) : mapped);
  }

  return c.json(mapped);
});

// ── PATCH /api/issues/:issueId ───────────────────────────────────────────

paperclipCompatRouter.patch("/issues/:issueId", async (c) => {
  const agent = c.get("agentContext");
  const { issueId } = c.req.param();
  const db = getDb();

  let body: {
    status?: string;
    comment?: string;
    title?: string;
  } = {};
  try {
    body = await c.req.json() as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, issueId), eq(tasks.companyId, agent.companyId)));

  if (!task) return c.json({ error: "Not found" }, 404);

  const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };

  if (body.status) {
    const archonStatus = paperclipToArchon(body.status);
    updates.status = archonStatus;
    if (archonStatus === "done") updates.completedAt = new Date();
  }
  if (body.title !== undefined) updates.title = body.title;

  await db.update(tasks).set(updates).where(eq(tasks.id, issueId));

  // Add comment if provided
  if (body.comment) {
    await db.insert(taskComments).values({
      id: randomUUID(),
      taskId: issueId,
      authorType: "agent",
      authorId: agent.id,
      content: body.comment,
      commentType: "message",
    });
  }

  const [updated] = await db.select().from(tasks).where(eq(tasks.id, issueId));
  return c.json(taskToIssue(updated!));
});

// ── POST /api/issues/:issueId/comments ───────────────────────────────────

paperclipCompatRouter.post("/issues/:issueId/comments", async (c) => {
  const agent = c.get("agentContext");
  const { issueId } = c.req.param();
  const db = getDb();

  let body: { body?: string } = {};
  try {
    body = await c.req.json() as typeof body;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.body) return c.json({ error: "body is required" }, 400);

  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, issueId), eq(tasks.companyId, agent.companyId)));

  if (!task) return c.json({ error: "Not found" }, 404);

  const id = randomUUID();
  await db.insert(taskComments).values({
    id,
    taskId: issueId,
    authorType: "agent",
    authorId: agent.id,
    content: body.body,
    commentType: "message",
  });

  const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, id));
  return c.json(commentToIssueComment(comment!), 201);
});

// ── GET /api/companies/:companyId/issues ─────────────────────────────────
// Supports ?assigneeAgentId=&status= for agent-specific task lookup

paperclipCompatRouter.get("/companies/:companyId/issues", async (c) => {
  const agent = c.get("agentContext");
  const { companyId } = c.req.param();
  const { assigneeAgentId, status: statusParam } = c.req.query();

  if (companyId !== agent.companyId) return c.json({ error: "Forbidden" }, 403);

  const db = getDb();
  const conditions = [eq(tasks.companyId, companyId)];

  if (assigneeAgentId) conditions.push(eq(tasks.agentId, assigneeAgentId));

  if (statusParam) {
    const paperclipStatuses = statusParam.split(",").map((s) => s.trim());
    const archonStatuses = paperclipStatuses.map(paperclipToArchon);
    conditions.push(inArray(tasks.status, archonStatuses));
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.updatedAt))
    .limit(100);

  return c.json(rows.map(taskToIssue));
});

// ── GET /api/companies/:companyId/agents ─────────────────────────────────
// Let agents list their peers

paperclipCompatRouter.get("/companies/:companyId/agents", async (c) => {
  const agent = c.get("agentContext");
  const { companyId } = c.req.param();

  if (companyId !== agent.companyId) return c.json({ error: "Forbidden" }, 403);

  const db = getDb();
  const rows = await db.select().from(agents).where(eq(agents.companyId, companyId));

  return c.json(rows.map((a) => ({
    id: a.id,
    companyId: a.companyId,
    name: a.name,
    role: a.role,
    adapterType: a.adapterType,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  })));
});
