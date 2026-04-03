import { PassThrough } from "node:stream";
import { getDocker } from "./docker-manager.js";

export interface ContainerRunOptions {
  image: string;
  command: string[];
  env: Record<string, string>;
  workspacePath?: string;
  apiKey: string;
  agentId: string;
  onLog?: (log: string) => void;
}

export async function runAgentContainer(
  opts: ContainerRunOptions
): Promise<{ exitCode: number }> {
  const docker = getDocker();

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
      AutoRemove: true,
      NetworkMode: "bridge",
    },
    WorkingDir: "/workspace",
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

  const result = (await container.wait()) as { StatusCode: number };

  return { exitCode: result.StatusCode };
}
