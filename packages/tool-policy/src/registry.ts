import { randomUUID } from "node:crypto";
import { getDb, toolRegistry } from "@archon/db";
import { eq } from "drizzle-orm";

export interface ToolDefinition {
  id: string;
  name: string;
  type: "mcp" | "skill" | "command" | "web";
  description?: string;
  platforms: string[];
  configSchema?: Record<string, unknown>;
  isSystem: boolean;
}

// Default system tools
export const SYSTEM_TOOLS: Omit<ToolDefinition, "id">[] = [
  { name: "bash", type: "command", description: "Execute shell commands", platforms: ["claude_code", "codex", "opencode"], isSystem: true },
  { name: "file_read", type: "command", description: "Read files from disk", platforms: ["claude_code", "codex", "opencode", "http"], isSystem: true },
  { name: "file_write", type: "command", description: "Write files to disk", platforms: ["claude_code", "codex", "opencode"], isSystem: true },
  { name: "web_search", type: "web", description: "Search the web", platforms: ["claude_code", "codex", "opencode", "http"], isSystem: true },
  { name: "mcp_filesystem", type: "mcp", description: "Filesystem MCP server", platforms: ["claude_code", "opencode"], isSystem: true },
];

export async function seedSystemTools(): Promise<void> {
  const db = getDb();
  for (const tool of SYSTEM_TOOLS) {
    const existing = await db.select().from(toolRegistry).where(eq(toolRegistry.name, tool.name));
    if (existing.length === 0) {
      await db.insert(toolRegistry).values({
        id: randomUUID(),
        ...tool,
        platforms: tool.platforms,
        configSchema: tool.configSchema ?? {},
        description: tool.description ?? null,
      });
    }
  }
}

export async function listTools(): Promise<ToolDefinition[]> {
  const rows = await getDb().select().from(toolRegistry);
  return rows.map(r => {
    const def: ToolDefinition = {
      id: r.id,
      name: r.name,
      type: r.type as ToolDefinition["type"],
      platforms: r.platforms as string[],
      isSystem: r.isSystem,
    };
    if (r.description !== null) def.description = r.description;
    if (r.configSchema !== null) def.configSchema = r.configSchema as Record<string, unknown>;
    return def;
  });
}
