export interface RunResult {
  result: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Run agent via HTTP adapter (e.g. the echo server or a real agent endpoint).
 * POSTs { agentId, taskId, context } to adapterConfig.url.
 */
export async function runViaHttpAdapter(params: {
  agentId: string;
  taskId?: string;
  url: string;
  context: string;
}): Promise<RunResult> {
  const response = await fetch(params.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: params.agentId,
      ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
      context: params.context,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(`HTTP adapter returned ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    result?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    result: data.result ?? "",
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
  };
}
