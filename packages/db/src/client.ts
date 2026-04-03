import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema/index.js";

let _pglite: PGlite | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPGlite(): PGlite {
  if (!_pglite) _pglite = new PGlite();
  return _pglite;
}

export function getDb() {
  if (!_db) _db = drizzle(getPGlite(), { schema });
  return _db;
}

export type Db = ReturnType<typeof getDb>;

export async function initAppTables(): Promise<void> {
  const pg = getPGlite();
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      mission TEXT,
      settings JSONB DEFAULT '{}',
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS company_members (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by TEXT,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      parent_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      adapter_type TEXT NOT NULL DEFAULT 'http',
      llm_config JSONB NOT NULL DEFAULT '{}',
      heartbeat_cron TEXT,
      monthly_budget_usd NUMERIC(10,4) DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      workspace_path TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_api_keys (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT '{}',
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
