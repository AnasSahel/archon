import { getEffectivePermissions } from "./matrix.js";
import { generateClaudeCodeConfig } from "./adapters/claude-code.js";
import { generateCodexConfig } from "./adapters/codex.js";
import { generateOpenCodeConfig } from "./adapters/opencode.js";
import { generateHttpManifest } from "./adapters/http.js";

export type AdapterType = "claude_code" | "codex" | "opencode" | "http";

export async function getAgentToolConfig(
  companyId: string,
  agentId: string,
  agentRole: string,
  adapterType: AdapterType
): Promise<Record<string, unknown>> {
  const perms = await getEffectivePermissions(companyId, agentId, agentRole);
  const allowed = perms.filter(p => p.allow);
  const blocked = perms.filter(p => !p.allow);

  switch (adapterType) {
    case "claude_code":
      return generateClaudeCodeConfig(
        allowed.map(p => p.toolName),
        blocked.map(p => p.toolName)
      );
    case "codex":
      return generateCodexConfig(allowed.map(p => p.toolName));
    case "opencode":
      return generateOpenCodeConfig(
        allowed.filter(p => p.toolName.startsWith("mcp_")).map(p => p.toolName)
      );
    case "http":
      return generateHttpManifest(
        allowed.map(p => ({ name: p.toolName, configOverride: p.configOverride }))
      );
  }
}
