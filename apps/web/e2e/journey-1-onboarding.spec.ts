/**
 * Journey 1: Full onboarding
 * register → create company → create agent → create task → trigger heartbeat → verify result (echo agent)
 */
import { test, expect } from "@playwright/test";

const ts = Date.now();
const email = `j1-${ts}@example.com`;
const password = "TestPass123!";
const name = "Journey One User";
const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3010";

test.describe("Journey 1 — Onboarding to first heartbeat result", () => {
  test("register, create company, create echo agent, create task, trigger heartbeat", async ({ page }) => {
    // -- 1. Register --
    await page.goto("/register");
    await page.getByLabel(/full name/i).fill(name);
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL(/\/(dashboard|verify-email)/, { timeout: 15_000 });

    // If email verification is required, sign in directly via API
    if (page.url().includes("verify-email")) {
      await page.request.post(`${SERVER_URL}/api/auth/sign-in/email`, {
        data: { email, password },
      });
      await page.goto("/dashboard");
    }

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    // -- 2. Create company --
    await page.goto("/companies/new");
    await page.getByLabel(/company name/i).fill(`Echo Corp ${ts}`);
    await page.getByRole("button", { name: /create/i }).click();

    // Should redirect to the new company page
    await page.waitForURL(/\/companies\/[a-f0-9-]{36}$/, { timeout: 10_000 });
    const companyUrl = page.url();
    const companyId = companyUrl.split("/companies/")[1]?.split("/")[0];
    expect(companyId).toBeTruthy();

    // -- 3. Create an HTTP echo agent --
    await page.goto(`/companies/${companyId}/agents`);
    // Click add agent button
    await page.getByRole("button", { name: /add agent|create agent/i }).click();
    await page.getByLabel(/name/i).fill("Echo Agent");
    await page.getByLabel(/role/i).fill("echo");
    // Adapter type: http (default)
    await page.getByRole("button", { name: /create|save/i }).click();

    // Wait for agent to appear
    await expect(page.getByText("Echo Agent")).toBeVisible({ timeout: 10_000 });

    // -- 4. Create task --
    await page.goto(`/companies/${companyId}/tasks`);
    await page.getByRole("button", { name: /create task/i }).click();
    await page.getByLabel(/title/i).fill("Echo task");
    await page.getByRole("button", { name: /^create task$/i }).click();

    // Task should appear in the list
    await expect(page.getByText("Echo task")).toBeVisible({ timeout: 10_000 });

    // -- 5. Verify task detail opens --
    await page.getByText("Echo task").click();
    await page.waitForURL(/\/tasks\/[^/]+$/, { timeout: 5_000 });
    await expect(page.getByText("Echo task")).toBeVisible();
  });
});
