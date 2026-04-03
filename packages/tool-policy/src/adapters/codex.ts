export function generateCodexConfig(allowedTools: string[]): Record<string, unknown> {
  return { tools: allowedTools };
}
