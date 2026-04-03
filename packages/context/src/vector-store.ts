import { getDb, getPGlite, agentMemory } from "@archon/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface VectorEntry {
  id: string;
  agentId: string;
  companyId: string;
  type?: "snapshot" | "memory";
  content: string;
  heartbeatCount?: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

async function embedWithOllama(text: string, ollamaUrl: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[] };
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

export async function upsertVector(entry: Omit<VectorEntry, "embedding">): Promise<void> {
  const ollamaUrl = process.env["OLLAMA_BASE_URL"];
  const db = getDb();

  let embedding: number[] | null = null;
  if (ollamaUrl) {
    embedding = await embedWithOllama(entry.content, ollamaUrl);
  }

  const id = entry.id ?? randomUUID();
  await db.insert(agentMemory).values({
    id,
    agentId: entry.agentId,
    companyId: entry.companyId,
    type: entry.type ?? "memory",
    content: entry.content,
    heartbeatCount: entry.heartbeatCount ?? 0,
    metadata: entry.metadata ?? {},
  });

  // Store embedding via raw SQL if available
  if (embedding && ollamaUrl) {
    const pg = getPGlite();
    try {
      await pg.exec(
        `UPDATE agent_memory SET embedding = '[${embedding.join(",")}]'::vector WHERE id = '${id}'`
      );
    } catch {
      // Vector column may not exist if extension unavailable — non-fatal
    }
  }
}

export async function searchVectors(
  agentId: string,
  query: string,
  topK = 5
): Promise<VectorEntry[]> {
  const ollamaUrl = process.env["OLLAMA_BASE_URL"];
  if (!ollamaUrl) return [];

  const embedding = await embedWithOllama(query, ollamaUrl);
  if (!embedding) return [];

  const pg = getPGlite();
  try {
    const result = await pg.query<{
      id: string;
      agent_id: string;
      company_id: string;
      type: string;
      content: string;
      heartbeat_count: number;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, agent_id, company_id, type, content, heartbeat_count, metadata, created_at
       FROM agent_memory
       WHERE agent_id = $1
         AND embedding IS NOT NULL
       ORDER BY embedding <-> '[${embedding.join(",")}]'::vector
       LIMIT $2`,
      [agentId, topK]
    );
    return result.rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      companyId: r.company_id,
      type: r.type as "snapshot" | "memory",
      content: r.content,
      heartbeatCount: r.heartbeat_count,
      metadata: r.metadata,
      createdAt: r.created_at,
    }));
  } catch {
    // Fallback: return most recent entries without vector search
    const db = getDb();
    const rows = await db
      .select()
      .from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.type, "memory")))
      .limit(topK);
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      companyId: r.companyId,
      type: r.type as "snapshot" | "memory",
      content: r.content,
      heartbeatCount: r.heartbeatCount,
      metadata: r.metadata ?? {},
      createdAt: r.createdAt,
    }));
  }
}
