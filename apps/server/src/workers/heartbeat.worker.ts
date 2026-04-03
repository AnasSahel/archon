import { Worker, type Job } from "bullmq";
import { getRedis } from "../lib/valkey.js";
import { resolveExecutionMode } from "../runtime/execution-router.js";
import { dispatch } from "@archon/notifications";

export interface HeartbeatJobData {
  agentId: string;
  companyId: string;
  taskId?: string;
  adapterType?: string;
  workspacePath?: string | null;
}

export function startHeartbeatWorker(): Worker {
  const worker = new Worker<HeartbeatJobData>(
    "heartbeat",
    async (job: Job<HeartbeatJobData>) => {
      const { agentId } = job.data;
      dispatch({
        type: "heartbeat_started",
        agentId,
        ...(job.data.taskId !== undefined ? { taskId: job.data.taskId } : {}),
      });

      // Phase 10: resolve execution mode; actual run delegated to runtime
      const mode = await resolveExecutionMode({
        adapterType: job.data.adapterType ?? "http",
        ...(job.data.workspacePath !== undefined
          ? { workspacePath: job.data.workspacePath }
          : {}),
      });

      console.log(
        `[heartbeat] Agent ${agentId} triggered (job ${job.id}) — mode: ${mode}`
      );
    },
    { connection: getRedis() }
  );

  worker.on("failed", (job, err) => {
    console.error(`[heartbeat] Job ${job?.id} failed:`, err);
  });

  return worker;
}
