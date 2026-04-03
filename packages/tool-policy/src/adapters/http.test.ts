import { describe, it, expect } from "vitest";
import { generateHttpManifest } from "./http.js";

describe("generateHttpManifest", () => {
  it("generates tool manifest", () => {
    const manifest = generateHttpManifest([
      { name: "bash", description: "Shell", configOverride: {} },
    ]);
    expect(manifest).toHaveProperty("tool_manifest");
    expect(Array.isArray(manifest.tool_manifest)).toBe(true);
  });
});
