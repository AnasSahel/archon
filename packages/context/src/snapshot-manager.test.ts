import { describe, it, expect } from "vitest";
import { estimateTokens, trimSnapshot } from "./snapshot-manager.js";
import type { SnapshotData } from "./snapshot-manager.js";

const makeSnapshot = (overrides?: Partial<SnapshotData>): SnapshotData => ({
  schema_version: "1",
  agent_id: "agent-1",
  task_id: null,
  heartbeat_count: 5,
  mission: { company_goal: "Build Archon", project_goal: "Phase 11", my_role: "Engineer", current_task: "Tests" },
  progress: { status: "in_progress", percent_complete: 90, completed_steps: ["step1"], next_steps: ["step2"] },
  decisions: [],
  artifacts: [],
  human_feedback: [],
  context_vars: {},
  ...overrides,
});

// Makes a long string to push token count over the 1500 trim threshold (need ~6000 chars)
const longStr = "a".repeat(1100);

describe("snapshot-manager", () => {
  it("estimates tokens", () => {
    const snap = makeSnapshot();
    const tokens = estimateTokens(snap);
    expect(tokens).toBeGreaterThan(0);
  });

  it("trims old decisions when count > 5 and snapshot exceeds token limit", () => {
    const decisions = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      decision: `decision ${i} ${longStr}`,
      rationale: `rationale ${longStr}`,
    }));
    const snap = makeSnapshot({ decisions });
    const trimmed = trimSnapshot(snap);
    expect(trimmed.decisions.length).toBeLessThanOrEqual(5);
  });

  it("trims old human_feedback when count > 3 and snapshot exceeds token limit", () => {
    const human_feedback = Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      content: `feedback ${i} ${longStr}`,
      author: "user",
    }));
    const snap = makeSnapshot({ human_feedback });
    const trimmed = trimSnapshot(snap);
    expect(trimmed.human_feedback.length).toBeLessThanOrEqual(3);
  });
});
