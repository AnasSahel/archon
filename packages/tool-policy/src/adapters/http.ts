export function generateHttpManifest(
  tools: Array<{ name: string; description?: string; configOverride: Record<string, unknown> }>
): Record<string, unknown> {
  return { tool_manifest: tools.map(t => ({ name: t.name, description: t.description ?? "", config: t.configOverride })) };
}
