import { trimSnapshot } from "./snapshot-manager.js";
import type { SnapshotData } from "./snapshot-manager.js";

const DEFAULT_SUMMARIZE_INTERVAL = 10;

export function shouldSummarize(heartbeatCount: number, interval = DEFAULT_SUMMARIZE_INTERVAL): boolean {
  return heartbeatCount > 0 && heartbeatCount % interval === 0;
}

export async function summarizeSnapshot(snapshot: SnapshotData): Promise<SnapshotData> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    // No API key — skip summarization, just trim
    return trimSnapshot(snapshot);
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Summarize this agent context snapshot into a more concise version.
Keep the same JSON structure. Condense decisions, artifacts, and progress into shorter summaries.
Keep the most important information. Target ~600 tokens total.

Current snapshot:
${JSON.stringify(snapshot, null, 2)}

Return ONLY valid JSON matching the same structure.`,
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);

    const result = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content.find((c) => c.type === "text")?.text ?? "";

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return trimSnapshot(snapshot);

    const summarized = JSON.parse(jsonMatch[0]) as SnapshotData;
    return { ...snapshot, ...summarized };
  } catch (err) {
    console.warn("[auto-summarizer] Failed, falling back to trim:", err);
    return trimSnapshot(snapshot);
  }
}
