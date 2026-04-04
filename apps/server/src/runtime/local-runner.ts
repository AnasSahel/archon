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

  const child = spawn(bin, args, {
    cwd: params.workspacePath ?? process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      ...params.env,
      PAPERCLIP_API_KEY: params.apiKey,
    },
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
