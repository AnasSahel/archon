import { streamAgentResponse } from "@archon/ai";
import { dispatch } from "@archon/notifications";
import type { AgentLLMConfig } from "@archon/ai";

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

/**
 * Run agent via LLM API (Anthropic / OpenAI stream).
 */
export async function runViaApi(params: {
  agentId: string;
  taskId?: string;
  llmConfig: AgentLLMConfig;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  onChunk?: (chunk: string) => void;
}): Promise<string> {
  dispatch({
    type: "heartbeat_started",
    agentId: params.agentId,
    ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
  });

  try {
    const result = await streamAgentResponse({
      agentId: params.agentId,
      ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
      llmConfig: params.llmConfig,
      messages: params.messages,
      onChunk: (chunk) => {
        dispatch({
          type: "heartbeat_token",
          agentId: params.agentId,
          ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
          token: chunk,
        });
        params.onChunk?.(chunk);
      },
    });

    dispatch({
      type: "heartbeat_completed",
      agentId: params.agentId,
      status: "completed",
      costUsd: 0,
    });
    return result;
  } catch (err) {
    dispatch({
      type: "agent_log",
      agentId: params.agentId,
      level: "error",
      message: String(err),
    });
    throw err;
  }
}
