import { runAgentContainer } from "@archon/sandbox";
import { dispatch } from "@archon/notifications";

export async function runViaDocker(params: {
  agentId: string;
  taskId?: string;
  image: string;
  command: string[];
  env: Record<string, string>;
  apiKey: string;
  workspacePath?: string;
  onLog?: (log: string) => void;
}): Promise<void> {
  dispatch({
    type: "heartbeat_started",
    agentId: params.agentId,
    ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
  });

  const result = await runAgentContainer({
    image: params.image,
    command: params.command,
    env: params.env,
    ...(params.workspacePath !== undefined
      ? { workspacePath: params.workspacePath }
      : {}),
    apiKey: params.apiKey,
    agentId: params.agentId,
    ...(params.onLog !== undefined ? { onLog: params.onLog } : {}),
  });

  if (result.exitCode !== 0) {
    dispatch({
      type: "agent_log",
      agentId: params.agentId,
      level: "error",
      message: `Container exited with code ${result.exitCode}`,
    });
  } else {
    dispatch({
      type: "heartbeat_completed",
      agentId: params.agentId,
      status: "completed",
      costUsd: 0,
    });
  }
}
