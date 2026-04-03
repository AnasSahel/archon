import { Redis } from "ioredis";

const VALKEY_URL = process.env.VALKEY_URL ?? "redis://localhost:6379";

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(VALKEY_URL, {
      maxRetriesPerRequest: null,  // required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return _redis;
}
