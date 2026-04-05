import { spawn } from "node:child_process";
import { dispatch } from "@archon/notifications";

export async function runViaLocal(params: {
  agentId: string;
  taskId?: string;
  command: string[];
  env: Record<string, string>;
  apiKey: string;
  workspacePath?: string;
  onLog?: (log: string) => void;
}): Promise<void> {
  const [bin, ...args] = params.command;
  if (!bin) throw new Error("runViaLocal: command must not be empty");

  // Build a clean env: inherit process.env but strip server-side PAPERCLIP_* and
  // ANTHROPIC_API_KEY so the CLI subprocess doesn't try to use them. Callers pass
  // only the env vars the subprocess actually needs via params.env.
  const baseEnv = { ...(process.env as Record<string, string>) };
  for (const key of Object.keys(baseEnv)) {
    if (key.startsWith("PAPERCLIP_") || key === "ANTHROPIC_API_KEY" || key === "OPENAI_API_KEY") {
      delete baseEnv[key];
    }
  }

  const childEnv: Record<string, string> = {
    ...baseEnv,
    ...params.env,
  };
  if (params.apiKey) {
    childEnv.PAPERCLIP_API_KEY = params.apiKey;
  }

  const child = spawn(bin, args, {
    cwd: params.workspacePath ?? process.cwd(),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (data: Buffer) => {
    const text = data.toString("utf8");
    params.onLog?.(text);
    dispatch({
      type: "heartbeat_token",
      agentId: params.agentId,
      ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
      token: text,
    });
  });

  // Capture stderr but don't stream as tokens — log it for debugging
  child.stderr.on("data", (data: Buffer) => {
    const text = data.toString("utf8");
    params.onLog?.(text);
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        dispatch({
          type: "agent_log",
          agentId: params.agentId,
          level: "error",
          message: `Local process exited with code ${code}`,
        });
      } else {
        dispatch({
          type: "heartbeat_completed",
          agentId: params.agentId,
          status: "completed",
          costUsd: 0,
        });
      }
      resolve();
    });
  });
}
