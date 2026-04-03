import { Queue } from "bullmq";
import { getRedis } from "./valkey.js";
import type { HeartbeatJobData } from "../workers/heartbeat.worker.js";

export async function enqueueHeartbeat(data: HeartbeatJobData): Promise<void> {
  const queue = new Queue<HeartbeatJobData>("heartbeat", { connection: getRedis() });
  await queue.add("heartbeat", data);
}
