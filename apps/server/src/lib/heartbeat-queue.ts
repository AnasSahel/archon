import { Queue } from "bullmq";
import { getRedis } from "./valkey.js";
import type { HeartbeatJobData } from "../workers/heartbeat.worker.js";

// Singleton queue instance to avoid creating a new connection per call
let _queue: Queue<HeartbeatJobData> | null = null;

function getQueue(): Queue<HeartbeatJobData> {
  if (!_queue) {
    _queue = new Queue<HeartbeatJobData>("heartbeat", {
      connection: getRedis(),
      defaultJobOptions: {
        // 3 retries with exponential backoff: 30s, 60s, 120s
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 30_000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return _queue;
}

export async function enqueueHeartbeat(data: HeartbeatJobData): Promise<void> {
  await getQueue().add("heartbeat", data);
}
