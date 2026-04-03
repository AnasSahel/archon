import { describe, it, expect } from "vitest";
import { generateClaudeCodeConfig } from "./claude-code.js";

describe("generateClaudeCodeConfig", () => {
  it("generates allowed tools config", () => {
    const config = generateClaudeCodeConfig(["bash", "file_read"], ["rm"]);
    expect(config).toHaveProperty("allowedTools");
    expect(config).toHaveProperty("blockedCommands");
  });

  it("maps tool names to objects", () => {
    const config = generateClaudeCodeConfig(["bash"], []);
    expect(Array.isArray(config.allowedTools)).toBe(true);
  });
});
