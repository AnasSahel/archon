import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Exclude Playwright E2E tests — those run via `test:e2e`
    exclude: ["e2e/**", "node_modules/**"],
    passWithNoTests: true,
  },
});
