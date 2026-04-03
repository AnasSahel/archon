import { streamAgentResponse } from "@archon/ai";
import { dispatch } from "@archon/notifications";
import type { AgentLLMConfig } from "@archon/ai";

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
      ...(params.onChunk !== undefined ? { onChunk: params.onChunk } : {}),
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
