import { getDb, getPGlite, agentMemory } from "@archon/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface VectorEntry {
  id: string;
  agentId: string;
  content: string;
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
    content: entry.content,
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
      content: string;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, agent_id, content, metadata, created_at
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
      content: r.content,
      metadata: r.metadata,
      createdAt: r.created_at,
    }));
  } catch {
    // Fallback: return most recent entries without vector search
    const db = getDb();
    const rows = await db
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.agentId, agentId))
      .limit(topK);
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      content: r.content,
      metadata: r.metadata ?? {},
      createdAt: r.createdAt,
    }));
  }
}
