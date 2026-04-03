export interface VectorEntry {
  id: string;
  agentId: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export async function upsertVector(entry: Omit<VectorEntry, "embedding">): Promise<void> {
  const ollamaUrl = process.env["OLLAMA_BASE_URL"];
  if (!ollamaUrl) {
    // Silently skip when Ollama is not available (dev mode without GPU)
    return;
  }
  // TODO Phase 10: call Ollama nomic-embed-text, store in pgvector
  console.log(`[vector-store] Would embed: "${entry.content.slice(0, 50)}..." for agent ${entry.agentId}`);
}

export async function searchVectors(
  agentId: string,
  query: string,
  topK = 5
): Promise<VectorEntry[]> {
  const ollamaUrl = process.env["OLLAMA_BASE_URL"];
  if (!ollamaUrl) return [];
  // TODO Phase 10: implement similarity search
  void agentId;
  void query;
  void topK;
  return [];
}
