import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, count } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, tasks, taskComments, auditLog, companyMembers, agents } from "@archon/db";
import { sessionMiddleware } from "../middleware/session.js";
import { writeAuditEntry } from "../lib/audit.js";
import { transitionHitl } from "../lib/hitl-service.js";
import { enqueueHeartbeat } from "../lib/heartbeat-queue.js";
import type { HitlEvent } from "@archon/hitl";

export const tasksRouter = new Hono();

// Apply session middleware to all tasks routes
tasksRouter.use("/companies/:companyId/tasks*", sessionMiddleware);
tasksRouter.use("/companies/:companyId/audit*", sessionMiddleware);

// Helper: verify user is a member of the company, return membership
async function getMembership(companyId: string, userId: string) {
  const db = getDb();
  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  return membership ?? null;
}

const createTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  agentId: z.string().optional(),
  parentTaskId: z.string().optional(),
  goalContext: z.record(z.unknown()).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  status: z.enum(["open", "in_progress", "awaiting_human", "escalated", "done", "cancelled"]).optional(),
  goalContext: z.record(z.unknown()).nullable().optional(),
});

const createCommentSchema = z.object({
  content: z.string().min(1),
  commentType: z.enum(["message", "review_request", "approve", "reject", "escalate", "snapshot"]).default("message"),
  metadata: z.record(z.unknown()).optional(),
});

// GET /companies/:companyId/tasks — list tasks with optional filters
tasksRouter.get("/companies/:companyId/tasks", async (c) => {
  const user = c.get("user");
  const { companyId } = c.req.param();
  const { status, agentId, page: pageStr, pageSize: pageSizeStr } = c.req.query();
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeStr ?? "25", 10) || 25));
  const offset = (page - 1) * pageSize;
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const conditions = [eq(tasks.companyId, companyId)];
  if (status) conditions.push(eq(tasks.status, status as "open" | "in_progress" | "awaiting_human" | "escalated" | "done" | "cancelled"));
  if (agentId) conditions.push(eq(tasks.agentId, agentId));

  const where = and(...conditions);
  const countResult = await db.select({ total: count() }).from(tasks).where(where);
  const total = countResult[0]?.total ?? 0;
  const rows = await db
    .select()
    .from(tasks)
    .where(where)
    .limit(pageSize)
    .offset(offset);

  return c.json({ data: rows, total, page, pageSize, pageCount: Math.ceil(total / pageSize) });
});

// POST /companies/:companyId/tasks — create task (board/manager only)
tasksRouter.post(
  "/companies/:companyId/tasks",
  zValidator("json", createTaskSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    const membership = await getMembership(companyId, user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board" && membership.role !== "manager") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const id = randomUUID();
    await db.insert(tasks).values({
      id,
      companyId,
      agentId: body.agentId ?? null,
      parentTaskId: body.parentTaskId ?? null,
      title: body.title,
      description: body.description ?? null,
      status: "open",
      goalContext: body.goalContext ?? null,
      createdBy: user.id,
    });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));

    await writeAuditEntry({
      companyId,
      entityType: "task",
      entityId: id,
      action: "task.created",
      actorType: "human",
      actorId: user.id,
      diff: { title: body.title, status: "open" },
    });

    return c.json(task, 201);
  }
);

// GET /companies/:companyId/tasks/:taskId — get task detail with comments
tasksRouter.get("/companies/:companyId/tasks/:taskId", async (c) => {
  const user = c.get("user");
  const { companyId, taskId } = c.req.param();
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)));

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const comments = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId));

  return c.json({ ...task, comments });
});

// PATCH /companies/:companyId/tasks/:taskId — update task (board/manager only; observer → 403)
tasksRouter.patch(
  "/companies/:companyId/tasks/:taskId",
  zValidator("json", updateTaskSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId, taskId } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    const membership = await getMembership(companyId, user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role === "observer" || membership.role === "auditor") {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (membership.role !== "board" && membership.role !== "manager") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)));

    if (!existing) {
      return c.json({ error: "Task not found" }, 404);
    }

    const updates: Partial<typeof tasks.$inferInsert> = {
      updatedAt: new Date(),
    };

    const diff: Record<string, unknown> = {};

    if (body.title !== undefined) {
      updates.title = body.title;
      diff.title = { from: existing.title, to: body.title };
    }
    if (body.description !== undefined) {
      updates.description = body.description;
      diff.description = { from: existing.description, to: body.description };
    }
    if (body.agentId !== undefined) {
      updates.agentId = body.agentId;
      diff.agentId = { from: existing.agentId, to: body.agentId };
    }
    if (body.goalContext !== undefined) {
      updates.goalContext = body.goalContext;
    }
    if (body.status !== undefined) {
      updates.status = body.status;
      diff.status = { from: existing.status, to: body.status };

      if (body.status === "done") {
        updates.completedAt = new Date();
      }
    }

    await db.update(tasks).set(updates).where(eq(tasks.id, taskId));

    const [updated] = await db.select().from(tasks).where(eq(tasks.id, taskId));

    await writeAuditEntry({
      companyId,
      entityType: "task",
      entityId: taskId,
      action: "task.updated",
      actorType: "human",
      actorId: user.id,
      diff,
    });

    // Auto-trigger heartbeat when an agent is (re-)assigned, unless the task is terminal
    const newAgentId = updates.agentId;
    const finalStatus = updates.status ?? existing.status;
    const agentChanged = newAgentId !== undefined && newAgentId !== null && newAgentId !== existing.agentId;
    const taskIsTerminal = finalStatus === "done" || finalStatus === "cancelled";
    if (agentChanged && !taskIsTerminal) {
      const [assignedAgent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, newAgentId!));
      if (assignedAgent && assignedAgent.status !== "paused" && assignedAgent.status !== "terminated") {
        await enqueueHeartbeat({
          agentId: newAgentId!,
          companyId,
          taskId,
          adapterType: assignedAgent.adapterType,
          workspacePath: assignedAgent.workspacePath,
        });
      }
    }

    return c.json(updated);
  }
);

// POST /companies/:companyId/tasks/:taskId/comments — add comment (any member)
tasksRouter.post(
  "/companies/:companyId/tasks/:taskId/comments",
  zValidator("json", createCommentSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId, taskId } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    const membership = await getMembership(companyId, user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)));

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const id = randomUUID();
    await db.insert(taskComments).values({
      id,
      taskId,
      authorType: "human",
      authorId: user.id,
      content: body.content,
      commentType: body.commentType,
      metadata: body.metadata ?? {},
    });

    const [comment] = await db
      .select()
      .from(taskComments)
      .where(eq(taskComments.id, id));

    await writeAuditEntry({
      companyId,
      entityType: "task_comment",
      entityId: id,
      action: "comment.created",
      actorType: "human",
      actorId: user.id,
      metadata: { taskId, commentType: body.commentType },
    });

    return c.json(comment, 201);
  }
);

// POST /companies/:companyId/tasks/:taskId/review — HITL approve/reject/comment/escalate (board only)
const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "comment", "escalate"]),
  feedback: z.string().optional(),
});

tasksRouter.post(
  "/companies/:companyId/tasks/:taskId/review",
  zValidator("json", reviewSchema),
  async (c) => {
    const user = c.get("user");
    const { companyId, taskId } = c.req.param();
    const body = c.req.valid("json");
    const db = getDb();

    const membership = await getMembership(companyId, user.id);
    if (!membership) {
      return c.json({ error: "Not found" }, 404);
    }
    if (membership.role !== "board") {
      return c.json({ error: "Forbidden" }, 403);
    }

    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)));

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    if (task.status !== "awaiting_human" && task.status !== "escalated") {
      return c.json({ error: "Task is not awaiting review" }, 400);
    }

    const context: import("@archon/hitl").HitlContext = {
      taskId,
      agentId: task.agentId ?? "",
      reviewRequired: true,
    };

    let event: HitlEvent;
    let commentType: "approve" | "reject" | "escalate" | "message" = "message";

    if (body.action === "approve") {
      event = { type: "APPROVE" };
      commentType = "approve";
    } else if (body.action === "reject") {
      const rejectEvent: { type: "REJECT"; feedback?: string } = { type: "REJECT" };
      if (body.feedback) rejectEvent.feedback = body.feedback;
      event = rejectEvent;
      commentType = "reject";
    } else if (body.action === "escalate") {
      // Manual escalation by board — skip XState, go directly to escalated
      await db
        .update(tasks)
        .set({ status: "escalated", updatedAt: new Date() })
        .where(eq(tasks.id, taskId));

      await db.insert(taskComments).values({
        id: randomUUID(),
        taskId,
        authorType: "human",
        authorId: user.id,
        content: body.feedback
          ? `Escalated: ${body.feedback}`
          : "Manually escalated by board member.",
        commentType: "escalate",
        metadata: { action: "escalate" },
      });

      await writeAuditEntry({
        companyId,
        entityType: "task",
        entityId: taskId,
        action: "task.review.escalate",
        actorType: "human",
        actorId: user.id,
        diff: { action: "escalate", feedback: body.feedback },
      });

      return c.json({ snapshot: { value: "ESCALATED", context } });
    } else {
      // comment
      if (!body.feedback) {
        return c.json({ error: "feedback is required for comment" }, 400);
      }
      event = { type: "COMMENT", content: body.feedback };
    }

    const snapshot = await transitionHitl(taskId, context, event);

    // Save review action as comment
    const commentContent =
      body.action === "approve"
        ? "Approved by board member."
        : body.action === "reject"
        ? body.feedback
          ? `Rejected: ${body.feedback}`
          : "Rejected by board member."
        : body.feedback ?? "";

    await db.insert(taskComments).values({
      id: randomUUID(),
      taskId,
      authorType: "human",
      authorId: user.id,
      content: commentContent,
      commentType,
      metadata: { action: body.action, feedback: body.feedback },
    });

    // If XState transitioned back to RUNNING, re-enqueue heartbeat so agent resumes
    if (snapshot.value === "RUNNING" && task.agentId) {
      await enqueueHeartbeat({
        agentId: task.agentId,
        companyId,
        taskId,
      });
    }

    await writeAuditEntry({
      companyId,
      entityType: "task",
      entityId: taskId,
      action: `task.review.${body.action}`,
      actorType: "human",
      actorId: user.id,
      diff: { action: body.action, feedback: body.feedback },
    });

    return c.json({ snapshot });
  }
);

// GET /companies/:companyId/audit — audit log for company (board/auditor only)
tasksRouter.get("/companies/:companyId/audit", async (c) => {
  const user = c.get("user");
  const { companyId } = c.req.param();
  const db = getDb();

  const membership = await getMembership(companyId, user.id);
  if (!membership) {
    return c.json({ error: "Not found" }, 404);
  }
  if (membership.role !== "board" && membership.role !== "auditor") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const rows = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.companyId, companyId));

  return c.json(rows);
});
