import { createMiddleware } from "hono/factory";
import { getRedis } from "../lib/valkey.js";

/**
 * Sliding-window rate limiter backed by Redis/Valkey.
 *
 * Agent API-key requests:  60 req/min  (Authorization: Bearer pf_…)
 * Human session requests:  200 req/min (session cookie or userId)
 */

const WINDOW_SEC = 60;
const AGENT_KEY_PREFIX = "rl:agent:";
const HUMAN_KEY_PREFIX = "rl:human:";

async function increment(key: string, limit: number): Promise<{ ok: boolean; remaining: number }> {
  const redis = getRedis();
  const multi = redis.multi();
  multi.incr(key);
  multi.expire(key, WINDOW_SEC);
  const [[, count]] = (await multi.exec()) as [[null, number]];
  const remaining = Math.max(0, limit - count);
  return { ok: count <= limit, remaining };
}

/** Extract a stable identity from the request for rate-limiting purposes. */
function resolveKey(c: Parameters<Parameters<typeof createMiddleware>[0]>[0]): {
  prefix: string;
  id: string;
  limit: number;
} {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer pf_")) {
    // Agent API key — use the key prefix (first 10 chars of the raw key)
    const raw = auth.slice(7); // strip "Bearer "
    return { prefix: AGENT_KEY_PREFIX, id: raw.slice(0, 20), limit: 60 };
  }
  // Human session — use IP as fallback; real session userId is set later by sessionMiddleware
  const forwarded = c.req.header("x-forwarded-for");
  const ip =
    (forwarded ? forwarded.split(",")[0]?.trim() : undefined) ??
    c.req.header("x-real-ip") ??
    "unknown";
  return { prefix: HUMAN_KEY_PREFIX, id: ip, limit: 200 };
}

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  let redis;
  try {
    redis = getRedis();
    await redis.ping();
  } catch {
    // If Redis is unavailable, skip rate limiting rather than blocking all traffic
    return next();
  }

  const { prefix, id, limit } = resolveKey(c);
  const key = `${prefix}${id}`;
  const { ok, remaining } = await increment(key, limit);

  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(remaining));
  c.header("X-RateLimit-Reset", String(Math.floor(Date.now() / 1000) + WINDOW_SEC));

  if (!ok) {
    c.header("Retry-After", String(WINDOW_SEC));
    return c.json(
      { error: "Rate limit exceeded", retryAfter: WINDOW_SEC },
      429
    );
  }

  return next();
});
