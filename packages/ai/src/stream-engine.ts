import { streamText } from "ai";
import { getProvider, type AgentLLMConfig } from "./provider-factory.js";
import { recordHeartbeat } from "./token-tracker.js";

export interface StreamEngineOptions {
  agentId: string;
  taskId?: string;
  llmConfig: AgentLLMConfig;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  onChunk?: (chunk: string) => void;
  onFinish?: (text: string) => void;
}

export async function streamAgentResponse(
  opts: StreamEngineOptions
): Promise<string> {
  const startedAt = new Date();
  const model = getProvider(opts.llmConfig);

  const result = streamText({
    model,
    messages: opts.messages,
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") {
        opts.onChunk?.(chunk.textDelta);
      }
    },
  });

  let fullText = "";
  for await (const text of result.textStream) {
    fullText += text;
  }

  const usage = await result.usage;

  // Cost estimate: ~$0.25/1M input, ~$1.25/1M output (Haiku pricing)
  const costUsd =
    ((usage?.promptTokens ?? 0) * 0.25 +
      (usage?.completionTokens ?? 0) * 1.25) /
    1_000_000;

  await recordHeartbeat(
    {
      agentId: opts.agentId,
      ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
      inputTokens: usage?.promptTokens ?? 0,
      outputTokens: usage?.completionTokens ?? 0,
      costUsd,
    },
    "completed",
    startedAt
  );

  opts.onFinish?.(fullText);
  return fullText;
}
