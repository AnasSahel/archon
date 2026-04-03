import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentToolConfig, type AdapterType } from "@archon/tool-policy";

/**
 * Writes adapter-specific tool policy config files into the workspace directory
 * before the agent container is launched.
 *
 * - claude_code  → <workspace>/.claude/settings.json
 * - codex        → <workspace>/codex.json
 * - opencode     → <workspace>/opencode.json
 */
export async function writeToolPolicy(params: {
  companyId: string;
  agentId: string;
  agentRole: string;
  adapterType: AdapterType;
  workspacePath: string;
}): Promise<void> {
  const config = await getAgentToolConfig(
    params.companyId,
    params.agentId,
    params.agentRole,
    params.adapterType
  );

  const json = JSON.stringify(config, null, 2);

  switch (params.adapterType) {
    case "claude_code": {
      const dir = join(params.workspacePath, ".claude");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "settings.json"), json, "utf-8");
      break;
    }
    case "codex": {
      await writeFile(join(params.workspacePath, "codex.json"), json, "utf-8");
      break;
    }
    case "opencode": {
      await writeFile(
        join(params.workspacePath, "opencode.json"),
        json,
        "utf-8"
      );
      break;
    }
    default:
      // http adapter — no file config needed
      break;
  }
}
