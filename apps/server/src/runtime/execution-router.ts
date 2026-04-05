import { isDockerAvailable } from "@archon/sandbox";

export type ExecutionMode = "docker" | "local" | "api";

export async function resolveExecutionMode(agent: {
  adapterType: string;
  workspacePath?: string | null;
  adapterConfig?: Record<string, unknown> | null;
}): Promise<ExecutionMode> {
  // CLI adapters default to local mode; Docker available via adapterConfig.executionMode = "docker"
  const cliAdapters = ["claude_code", "codex", "opencode"];
  if (cliAdapters.includes(agent.adapterType)) {
    if (agent.adapterConfig?.executionMode === "docker") {
      const dockerOk = await isDockerAvailable();
      if (dockerOk) return "docker";
    }
    return "local";
  }
  return "api";
}
