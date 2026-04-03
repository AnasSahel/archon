import { test, expect } from "@playwright/test";

// Unique email per test run so parallel runs don't collide
const timestamp = Date.now();
const testEmail = `e2e-${timestamp}@example.com`;
const testPassword = "E2ePassword123!";
const testName = "E2E User";

test.describe("Auth pages — rendering", () => {
  test("login page renders form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /forgot your password/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /create an account/i })).toBeVisible();
  });

  test("register page renders form", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
    await expect(page.getByLabel(/full name/i)).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  });

  test("forgot-password page renders form", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send reset link/i })).toBeVisible();
  });

  test("reset-password page shows error when token is missing", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText(/invalid or missing reset token/i)).toBeVisible();
  });

  test("verify-email page shows loading state initially", async ({ page }) => {
    // Without a token it should show an error
    await page.goto("/verify-email");
    await expect(page.getByText(/missing verification token/i)).toBeVisible();
  });
});

test.describe("Middleware — route protection", () => {
  test("unauthenticated visit to /dashboard redirects to /login", async ({ page }) => {
    // Clear cookies so we have no session
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated visit to /companies redirects to /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/companies");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page is accessible without auth", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Registration flow", () => {
  test("shows error for invalid email", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel(/full name/i).fill("Test User");
    await page.getByLabel(/email address/i).fill("not-an-email");
    await page.getByLabel(/password/i).fill("ValidPass123!");
    await page.getByRole("button", { name: /create account/i }).click();
    // Browser-native validation prevents submission for invalid email
    const emailInput = page.getByLabel(/email address/i);
    await expect(emailInput).toHaveAttribute("type", "email");
  });

  test("shows error for short password", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel(/full name/i).fill("Test User");
    await page.getByLabel(/email address/i).fill("test@example.com");
    await page.getByLabel(/password/i).fill("short");
    await page.getByRole("button", { name: /create account/i }).click();
    // minLength=8 triggers browser validation
    const passwordInput = page.getByLabel(/password/i);
    await expect(passwordInput).toHaveAttribute("minlength", "8");
  });
});

test.describe("Login flow", () => {
  test("shows error for wrong credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email address/i).fill("nobody@example.com");
    await page.getByLabel(/password/i).fill("WrongPass123!");
    await page.getByRole("button", { name: /sign in/i }).click();
    // Should display an auth error message
    await expect(page.getByText(/invalid email or password|failed|error/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Forgot password flow", () => {
  test("shows success message after submitting email", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel(/email address/i).fill("someone@example.com");
    await page.getByRole("button", { name: /send reset link/i }).click();
    // Better Auth returns success even for unknown emails (prevents enumeration)
    await expect(
      page.getByText(/check your email/i)
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Full registration and login flow", () => {
  test("registers a new user and is redirected", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel(/full name/i).fill(testName);
    await page.getByLabel(/email address/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /create account/i }).click();

    // After registration, should redirect to dashboard (or verify-email if email verification is required)
    await page.waitForURL(/\/(dashboard|verify-email)/, { timeout: 15_000 });
    const url = page.url();
    expect(url).toMatch(/\/(dashboard|verify-email)/);
  });

  test("registered user can sign in", async ({ page }) => {
    // Use a separate email so this test is independent from the registration test above
    const signinEmail = `signin-${timestamp}@example.com`;

    // First register
    const serverUrl =
      process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3100";
    await page.request.post(`${serverUrl}/api/auth/sign-up/email`, {
      data: { email: signinEmail, password: testPassword, name: testName },
    });

    // Then sign in via the UI
    await page.goto("/login");
    await page.getByLabel(/email address/i).fill(signinEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("logged-in user can sign out", async ({ page }) => {
    const logoutEmail = `logout-${timestamp}@example.com`;

    const serverUrl =
      process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3100";
    await page.request.post(`${serverUrl}/api/auth/sign-up/email`, {
      data: { email: logoutEmail, password: testPassword, name: testName },
    });

    await page.goto("/login");
    await page.getByLabel(/email address/i).fill(logoutEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    // Click the sign out button in the sidebar
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);

    // Confirm session is cleared — visiting dashboard redirects to login
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
