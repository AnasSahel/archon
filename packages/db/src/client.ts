import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import * as schema from "./schema/index.js";

let _pglite: PGlite | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPGlite(): PGlite {
  if (!_pglite) _pglite = new PGlite({ extensions: { vector } });
  return _pglite;
}

export function getDb() {
  if (!_db) _db = drizzle(getPGlite(), { schema });
  return _db;
}

export type Db = ReturnType<typeof getDb>;

export async function initAppTables(): Promise<void> {
  const pg = getPGlite();

  // Enable pgvector extension (silently skip if unavailable)
  try {
    await pg.exec(`CREATE EXTENSION IF NOT EXISTS vector;`);
  } catch {
    console.warn("[db] pgvector extension not available — vector search disabled");
  }

  // Better Auth tables must exist before app tables that reference users(id)
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      expires_at TIMESTAMPTZ,
      password TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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
      adapter_config JSONB DEFAULT '{}',
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

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      hitl_state JSONB,
      locked_at TIMESTAMPTZ,
      locked_reason TEXT,
      review_required_by TIMESTAMPTZ,
      goal_context JSONB,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author_type TEXT NOT NULL,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      comment_type TEXT NOT NULL DEFAULT 'message',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      diff JSONB,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_budgets (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      period_month TEXT NOT NULL,
      budget_usd NUMERIC(10,4) NOT NULL,
      spent_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      paused_at TIMESTAMPTZ,
      UNIQUE(agent_id, period_month)
    );

    CREATE TABLE IF NOT EXISTS heartbeats (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      task_id TEXT,
      status TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost_usd NUMERIC(10,6) DEFAULT 0,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS agent_snapshots (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      task_id TEXT,
      heartbeat_count INTEGER NOT NULL DEFAULT 0,
      content JSONB NOT NULL,
      token_estimate INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // agent_memory table (pgvector — created separately, gracefully skips embedding column if vector unavailable)
  try {
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        embedding vector(1536),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS agent_memory_agent_id_idx ON agent_memory(agent_id);
    `);
  } catch {
    // Fallback: create without embedding column if vector type not available
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS agent_memory_agent_id_idx ON agent_memory(agent_id);
    `);
    console.warn("[db] agent_memory created without vector embedding column");
  }

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS tool_registry (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      description TEXT,
      platforms TEXT[] NOT NULL DEFAULT '{}',
      config_schema JSONB DEFAULT '{}',
      is_system BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tool_permissions (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      agent_role TEXT,
      agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
      tool_id TEXT NOT NULL REFERENCES tool_registry(id) ON DELETE CASCADE,
      allow BOOLEAN NOT NULL DEFAULT true,
      config_override JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
