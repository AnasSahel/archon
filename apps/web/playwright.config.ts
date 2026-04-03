import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Archon web E2E tests.
 *
 * To run locally:
 *   1. Start infra: pnpm infra:up
 *   2. Start server: pnpm dev --filter @archon/server
 *   3. Run tests:   pnpm --filter @archon/web test:e2e
 *
 * CI: set PLAYWRIGHT_BASE_URL to the deployed web URL.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Start Next.js dev server automatically when running locally
  ...(process.env.CI
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
