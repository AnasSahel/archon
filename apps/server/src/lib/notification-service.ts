/**
 * Notification service — subscribes to the in-process event bus and:
 *   1. Logs every event to stdout (always)
 *   2. Posts automatic task comments for key events (heartbeat_completed, hitl_gate_triggered, budget_alert)
 *   3. Fires Slack/Discord/email hooks when the relevant env vars are set
 */

import { randomUUID } from "node:crypto";
import { subscribe, dispatch } from "@archon/notifications";
import { sendSlackNotification } from "@archon/notifications";
import { sendEmail } from "@archon/notifications";
import { getDb, taskComments } from "@archon/db";

function fmt(event: Parameters<Parameters<typeof subscribe>[0]>[0]): string {
  switch (event.type) {
    case "heartbeat_started":
      return `[notify] heartbeat_started  agent=${event.agentId}${event.taskId ? ` task=${event.taskId}` : ""}`;
    case "heartbeat_completed":
      return `[notify] heartbeat_completed agent=${event.agentId} status=${event.status} cost=$${event.costUsd.toFixed(6)}`;
    case "heartbeat_token":
      return ""; // too noisy — skip
    case "task_updated":
      return `[notify] task_updated       task=${event.taskId} status=${event.status}${event.agentId ? ` agent=${event.agentId}` : ""}`;
    case "hitl_gate_triggered":
      return `[notify] hitl_gate_triggered task=${event.taskId} agent=${event.agentId}`;
    case "budget_alert":
      return `[notify] budget_alert        agent=${event.agentId} ${event.percentUsed.toFixed(1)}% status=${event.status}`;
    case "agent_log":
      return `[notify] agent_log           agent=${event.agentId} [${event.level}] ${event.message}`;
    default:
      return `[notify] unknown event`;
  }
}

async function postTaskComment(taskId: string, agentId: string, content: string) {
  try {
    const db = getDb();
    await db.insert(taskComments).values({
      id: randomUUID(),
      taskId,
      authorType: "agent",
      authorId: agentId,
      content,
      commentType: "snapshot",
      metadata: { source: "notification_service" },
    });
  } catch (err) {
    console.error("[notify] failed to post task comment:", err);
  }
}

async function fireSlack(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await sendSlackNotification(url, text);
  } catch (err) {
    console.error("[notify] Slack hook failed:", err);
  }
}

async function fireEmail(subject: string, html: string) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;
  try {
    await sendEmail({ to, subject, html });
  } catch (err) {
    console.error("[notify] email hook failed:", err);
  }
}

export function startNotificationService(): () => void {
  const unsubscribe = subscribe(async (event) => {
    const line = fmt(event);
    if (line) console.log(line);

    switch (event.type) {
      case "hitl_gate_triggered": {
        // Post automatic comment on the task
        await postTaskComment(
          event.taskId,
          event.agentId,
          `**Human review required** — task is awaiting approval.\n\nAssigned agent \`${event.agentId}\` has submitted results for review. Please approve or reject in the dashboard.`
        );
        // Fire external hooks
        const msg = `🔔 *HITL review required* — task \`${event.taskId}\` is awaiting human approval.`;
        await fireSlack(msg);
        await fireEmail(
          "Archon: Human review required",
          `<p>Task <b>${event.taskId}</b> requires your review. Open the dashboard to approve or reject.</p>`
        );
        break;
      }

      case "budget_alert": {
        if (event.status === "paused") {
          const msg = `⚠️ *Agent paused* — agent \`${event.agentId}\` has reached its monthly budget limit (${event.percentUsed.toFixed(0)}% used).`;
          await fireSlack(msg);
          await fireEmail(
            "Archon: Agent paused — budget limit reached",
            `<p>Agent <b>${event.agentId}</b> has been paused after reaching ${event.percentUsed.toFixed(0)}% of its monthly budget.</p>`
          );
        } else if (event.percentUsed >= 80) {
          const msg = `⚠️ *Budget warning* — agent \`${event.agentId}\` is at ${event.percentUsed.toFixed(0)}% of its monthly budget.`;
          await fireSlack(msg);
        }
        break;
      }

      case "heartbeat_completed": {
        if (event.status === "failed") {
          const msg = `🔴 *Heartbeat failed* — agent \`${event.agentId}\`.`;
          await fireSlack(msg);
        }
        break;
      }

      default:
        break;
    }
  });

  console.log("[notify] notification service started");
  return unsubscribe;
}
