import { getDb, toolPermissions, toolRegistry } from "@archon/db";
import { eq } from "drizzle-orm";

export async function getEffectivePermissions(
  companyId: string,
  agentId: string,
  agentRole: string
): Promise<Array<{ toolId: string; toolName: string; allow: boolean; configOverride: Record<string, unknown> }>> {
  const db = getDb();

  // Get all tools
  const tools = await db.select().from(toolRegistry);

  // Get all permissions for this company (agent-specific + role-specific)
  const perms = await db
    .select()
    .from(toolPermissions)
    .where(eq(toolPermissions.companyId, companyId));

  return tools.map(tool => {
    // Priority: agent-specific override > role-specific > default (allow)
    const agentPerm = perms.find(p => p.agentId === agentId && p.toolId === tool.id);
    const rolePerm = perms.find(p => p.agentRole === agentRole && p.agentId === null && p.toolId === tool.id);

    const effective = agentPerm ?? rolePerm;
    return {
      toolId: tool.id,
      toolName: tool.name,
      allow: effective?.allow ?? true,
      configOverride: (effective?.configOverride as Record<string, unknown>) ?? {},
    };
  });
}
