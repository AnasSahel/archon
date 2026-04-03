import { Worker, Queue } from "bullmq";
import { getRedis } from "../lib/valkey.js";
import { removeZombieContainers } from "@archon/sandbox";
import { isDockerAvailable } from "@archon/sandbox";

const QUEUE_NAME = "container-cleanup";
const REPEAT_EVERY_MS = 5 * 60 * 1000; // every 5 minutes

export function startContainerCleanupWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const dockerOk = await isDockerAvailable();
      if (!dockerOk) {
        console.log("[container-cleanup] Docker not available — skipping cleanup");
        return;
      }
      const removed = await removeZombieContainers();
      if (removed > 0) {
        console.log(`[container-cleanup] Removed ${removed} zombie container(s)`);
      }
    },
    { connection: getRedis() }
  );

  worker.on("failed", (_job, err) => {
    console.error("[container-cleanup] Job failed:", err);
  });

  return worker;
}

/**
 * Register the repeating cleanup job.
 * Call once at server startup (idempotent via jobId).
 */
export async function scheduleContainerCleanup(): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection: getRedis() });
  await queue.add(
    "cleanup",
    {},
    {
      jobId: "zombie-cleanup-repeat",
      repeat: { every: REPEAT_EVERY_MS },
    }
  );
}
