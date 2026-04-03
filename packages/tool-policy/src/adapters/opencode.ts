export function generateOpenCodeConfig(mcpServers: string[]): Record<string, unknown> {
  return { mcp: { servers: mcpServers } };
}
