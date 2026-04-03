import { PassThrough } from "node:stream";
import { getDocker } from "./docker-manager.js";
import { ensureAgentNetwork } from "./network.js";

const DEFAULT_TIMEOUT_MS = parseInt(
  process.env.AGENT_CONTAINER_TIMEOUT_MS ?? "600000",
  10
);

export interface ContainerRunOptions {
  image: string;
  command: string[];
  env: Record<string, string>;
  workspacePath?: string;
  apiKey: string;
  agentId: string;
  timeoutMs?: number;
  onLog?: (log: string) => void;
}

export async function runAgentContainer(
  opts: ContainerRunOptions
): Promise<{ exitCode: number }> {
  const docker = getDocker();
  const networkName = await ensureAgentNetwork();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const envVars = Object.entries({
    ...opts.env,
    PAPERCLIP_API_KEY: opts.apiKey,
    PAPERCLIP_AGENT_ID: opts.agentId,
    PAPERCLIP_API_URL:
      process.env.SERVER_URL ?? "http://host.docker.internal:3100",
  }).map(([k, v]) => `${k}=${v}`);

  const binds = opts.workspacePath
    ? [`${opts.workspacePath}:/workspace`]
    : [];

  const container = await docker.createContainer({
    Image: opts.image,
    Cmd: opts.command,
    Env: envVars,
    HostConfig: {
      Binds: binds,
      AutoRemove: false, // We remove manually so we can capture exit code reliably
      NetworkMode: networkName,
      // Never mount the Docker socket — agents must not control the host daemon
    },
    WorkingDir: "/workspace",
    Labels: {
      "archon.managed": "true",
      "archon.agent-id": opts.agentId,
      "archon.started-at": new Date().toISOString(),
    },
  });

  const stdout = new PassThrough();
  const stderr = new PassThrough();

  stdout.on("data", (chunk: Buffer) => opts.onLog?.(chunk.toString()));
  stderr.on("data", (chunk: Buffer) =>
    opts.onLog?.(`[stderr] ${chunk.toString()}`)
  );

  const logStream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (docker.modem as any).demuxStream(logStream, stdout, stderr);

  await container.start();

  // Enforce execution timeout
  const timeoutHandle = setTimeout(async () => {
    opts.onLog?.(`[archon] Container timeout (${timeoutMs}ms) — killing`);
    try {
      await container.kill();
    } catch {
      // Container may have already exited
    }
  }, timeoutMs);

  let exitCode: number;
  try {
    const result = (await container.wait()) as { StatusCode: number };
    exitCode = result.StatusCode;
  } finally {
    clearTimeout(timeoutHandle);
    // Always remove container (AutoRemove=false so we control cleanup)
    try {
      await container.remove({ force: true });
    } catch {
      // Ignore removal errors (container may already be gone)
    }
  }

  return { exitCode };
}

/**
 * Remove all stopped archon-managed containers that have been lingering.
 * Called by the zombie cleanup cron job.
 */
export async function removeZombieContainers(): Promise<number> {
  const docker = getDocker();
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({
      label: ["archon.managed=true"],
      status: ["exited", "dead"],
    }),
  });

  let removed = 0;
  for (const info of containers) {
    try {
      const c = docker.getContainer(info.Id);
      await c.remove({ force: true });
      removed++;
    } catch {
      // Best-effort
    }
  }
  return removed;
}
