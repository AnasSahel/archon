import { randomUUID } from "node:crypto";
import { getDb, auditLog } from "@archon/db";

export async function writeAuditEntry(params: {
  companyId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: "human" | "agent" | "system";
  actorId: string;
  diff?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await getDb().insert(auditLog).values({
    id: randomUUID(),
    ...params,
    diff: params.diff ?? null,
    metadata: params.metadata ?? {},
  });
}
