// Generates .claude/settings.json compatible config
export function generateClaudeCodeConfig(
  allowedTools: string[],
  blockedTools: string[]
): Record<string, unknown> {
  return {
    allowedTools: allowedTools.map(t => ({ name: t })),
    blockedCommands: blockedTools,
  };
}
