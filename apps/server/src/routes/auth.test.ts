import { describe, it, expect, beforeAll } from "vitest";
import { initAppTables } from "@archon/db";
import { app } from "../app.js";

// Ensure Better Auth tables and app tables exist before any auth request
beforeAll(async () => {
  await initAppTables();
});

const TEST_EMAIL = `test-${Date.now()}@example.com`;
const TEST_PASSWORD = "TestPassword123!";
const TEST_NAME = "Test User";

describe("POST /api/auth/sign-up/email", () => {
  it("creates a new user and returns session", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_NAME,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("user");
    const user = body.user as Record<string, unknown>;
    expect(user.email).toBe(TEST_EMAIL);
    expect(user.name).toBe(TEST_NAME);
  });

  it("rejects duplicate email with 422", async () => {
    // Register the same email twice
    const payload = JSON.stringify({
      email: `dup-${Date.now()}@example.com`,
      password: TEST_PASSWORD,
      name: TEST_NAME,
    });

    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    expect(res.status).toBe(422);
  });
});

describe("POST /api/auth/sign-in/email", () => {
  const SIGNIN_EMAIL = `signin-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Pre-register user for sign-in tests
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: SIGNIN_EMAIL,
        password: TEST_PASSWORD,
        name: TEST_NAME,
      }),
    });
  });

  it("returns a session token for valid credentials", async () => {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: SIGNIN_EMAIL, password: TEST_PASSWORD }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("token");
    const user = body.user as Record<string, unknown>;
    expect(user.email).toBe(SIGNIN_EMAIL);
  });

  it("returns 401 for wrong password", async () => {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: SIGNIN_EMAIL,
        password: "WrongPassword999!",
      }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown email", async () => {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nobody@example.com",
        password: TEST_PASSWORD,
      }),
    });

    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/sign-out", () => {
  it("returns 200 and clears the session", async () => {
    // Sign in to get a session token first
    const signInRes = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    expect(signInRes.status).toBe(200);
    const { token } = (await signInRes.json()) as { token: string };

    const res = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(200);
  });
});
