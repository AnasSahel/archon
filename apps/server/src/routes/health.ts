import { Hono } from "hono";

export const healthRouter = new Hono();

healthRouter.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "archon-server",
    version: process.env.npm_package_version ?? "0.0.1",
  });
});
