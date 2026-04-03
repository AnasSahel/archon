import { anthropic } from "@ai-sdk/anthropic";
import { openai, createOpenAI } from "@ai-sdk/openai";

export interface AgentLLMConfig {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
}

export function getProvider(config: AgentLLMConfig) {
  switch (config.provider) {
    case "anthropic":
      return anthropic(config.model);
    case "openai":
      return openai(config.model);
    case "ollama": {
      const ollamaUrl = process.env.OLLAMA_BASE_URL;
      if (!ollamaUrl) {
        console.warn(
          "[ai] OLLAMA_BASE_URL not set, falling back to anthropic claude-haiku-4-5-20251001"
        );
        return anthropic("claude-haiku-4-5-20251001");
      }
      const ollamaProvider = createOpenAI({
        baseURL: `${ollamaUrl}/v1`,
        apiKey: "ollama",
      });
      return ollamaProvider(config.model);
    }
    default:
      return anthropic("claude-haiku-4-5-20251001");
  }
}
