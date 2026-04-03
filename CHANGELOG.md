# Changelog

All notable changes to Archon are documented here.

## [0.1.0.0] - 2026-04-03

### Added

**Authentication**
- Email/password sign-up, sign-in, forgot password, reset password, and email verification flows via Better Auth
- Auth pages: login, register, forgot-password, reset-password, verify-email
- Dashboard shell with sidebar navigation and session-aware user display

**Companies & RBAC**
- Create and manage companies with role-based access control (board, manager, observer, auditor)
- Invite members, change roles, remove members
- Company settings and member management UI

**Agents & Org Chart**
- Create and configure AI agents with adapter type, LLM config, heartbeat cron, and workspace path
- Visual org chart showing agent reporting hierarchy
- Agent detail panel with status, config, and API key management
- API key generation with SHA-256 hashing and `pf_` prefix

**Tasks & Tickets**
- Full task lifecycle: open, in_progress, awaiting_human, escalated, done, cancelled
- Task comments with types: message, review_request, approve, reject, escalate, snapshot
- Immutable audit log for all task state changes
- HITL review endpoint for human approval workflows

**Budgets & Cost Tracking**
- Monthly budget limits per agent with atomic spend tracking
- Budget dashboard showing spend vs limit across all company agents
- BullMQ worker to auto-pause agents when budget is exceeded (skips if no limit set)

**HITL Gate Engine**
- XState v5 state machine: IDLE → RUNNING → AWAITING_HUMAN → (ESCALATED|DONE)
- Snapshot persistence for resumable HITL sessions
- Transition API: approve, reject, escalate, resume

**Context Intelligence Layer**
- Agent snapshot system: structured context including mission, progress, decisions, artifacts
- Token estimation and trimming to fit LLM context windows
- Auto-summarizer via Claude Haiku for compressing long histories
- Vector store stub (ready for Ollama/pgvector integration)

**Tool Policy Engine**
- System tool catalogue with per-tool risk levels
- Permission matrix: agent-level > role-level > default
- Adapter-specific tool injection for claude-code, codex, opencode, http adapters

**Agent Runtime & Streaming**
- Vercel AI SDK streaming runner (Anthropic, OpenAI, Ollama providers)
- Docker container runner for sandboxed agent execution
- Execution router: picks Docker or API mode based on agent config
- SSE endpoint (`/stream/companies/:companyId`) for live agent events, scoped to company
- BullMQ heartbeat worker for scheduled agent runs

**Infrastructure**
- Turborepo monorepo with pnpm workspaces
- PGlite (in-memory PostgreSQL) for zero-dependency local dev
- Drizzle ORM schema for all entities: users, sessions, accounts, companies, agents, tasks, budgets, snapshots, tools
- Hono.js API server at port 3100
- Next.js 15 App Router web client at port 3000

### Fixed

- Snapshot route auth bypass: cross-tenant agentId access now blocked by company membership check
- Budget trackCost race condition: now uses atomic SQL increment
- Budget query: scoped to company agents only
- Agent update: companyId added to WHERE clause
- SSE stream: events filtered to company agents only
- Budget check: limit=0 (no explicit budget) no longer auto-pauses agents
- Task list: filters pushed to SQL instead of application memory
- Auth: fails fast if BETTER_AUTH_SECRET is unset in production
- Auth: reset/verify URLs only logged in development
