import { isDockerAvailable } from "@archon/sandbox";

export type ExecutionMode = "docker" | "api";

export async function resolveExecutionMode(agent: {
  adapterType: string;
  workspacePath?: string | null;
}): Promise<ExecutionMode> {
  // CLI adapters prefer Docker mode
  const cliAdapters = ["claude_code", "codex", "opencode"];
  if (cliAdapters.includes(agent.adapterType)) {
    const dockerOk = await isDockerAvailable();
    return dockerOk ? "docker" : "api";
  }
  return "api";
}
