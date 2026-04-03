import { createActor } from "xstate";
import { hitlMachine } from "@archon/hitl";
import type { HitlContext, HitlEvent, HitlSnapshot, HitlStatus } from "@archon/hitl";
import { getDb, tasks } from "@archon/db";
import { eq } from "drizzle-orm";

export async function getHitlSnapshot(taskId: string): Promise<HitlSnapshot | null> {
  const [task] = await getDb().select().from(tasks).where(eq(tasks.id, taskId));
  if (!task?.hitlState) return null;
  return task.hitlState as HitlSnapshot;
}

export async function transitionHitl(
  taskId: string,
  context: HitlContext,
  event: HitlEvent
): Promise<HitlSnapshot> {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

  // Retrieve previously persisted xstate snapshot (from getPersistedSnapshot)
  const persistedXstateSnapshot = task?.hitlState != null
    ? (task.hitlState as Record<string, unknown>)["_xstate"] ?? null
    : null;

  const actor = createActor(hitlMachine, {
    input: context,
    ...(persistedXstateSnapshot != null
      ? { snapshot: persistedXstateSnapshot as Parameters<typeof createActor>[1] extends { snapshot?: infer S } ? NonNullable<S> : never }
      : {}),
  });

  actor.start();
  actor.send(event);

  const xstateSnapshot = actor.getPersistedSnapshot();
  const actorSnapshot = actor.getSnapshot();

  const newSnapshot: HitlSnapshot = {
    value: actorSnapshot.value as HitlStatus,
    context: actorSnapshot.context,
  };

  actor.stop();

  // Persist both our summary snapshot and the raw xstate snapshot
  const now = new Date();
  const updates: Record<string, unknown> = {
    hitlState: { ...newSnapshot, _xstate: xstateSnapshot },
    updatedAt: now,
  };

  if (newSnapshot.value === "AWAITING_HUMAN") {
    updates.lockedAt = now;
    updates.lockedReason = "Awaiting human review";
    updates.status = "awaiting_human";
    // Set review deadline 24h from now
    const deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    updates.reviewRequiredBy = deadline;
  } else if (newSnapshot.value === "ESCALATED") {
    updates.status = "escalated";
  } else if (newSnapshot.value === "RUNNING") {
    updates.lockedAt = null;
    updates.lockedReason = null;
    updates.status = "in_progress";
  } else if (newSnapshot.value === "DONE") {
    updates.status = "done";
    updates.completedAt = now;
  }

  await db.update(tasks).set(updates).where(eq(tasks.id, taskId));

  return newSnapshot;
}
