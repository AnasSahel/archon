import { Worker, type Job } from "bullmq";
import { getRedis } from "../lib/valkey.js";

export interface HeartbeatJobData {
  agentId: string;
  companyId: string;
  taskId?: string;
}

export function startHeartbeatWorker(): Worker {
  const worker = new Worker<HeartbeatJobData>(
    "heartbeat",
    async (job: Job<HeartbeatJobData>) => {
      // Placeholder: In Phase 10 (Agent Runtime), this will actually execute the agent.
      // For now, just log the heartbeat trigger.
      console.log(`[heartbeat] Agent ${job.data.agentId} triggered (job ${job.id})`);
    },
    { connection: getRedis() }
  );

  worker.on("failed", (job, err) => {
    console.error(`[heartbeat] Job ${job?.id} failed:`, err);
  });

  return worker;
}
