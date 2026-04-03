# Archon — AI Agent Orchestration Platform

A platform for managing teams of autonomous AI agents organized as virtual companies.

## Architecture

- **apps/web** — Next.js 15 App Router dashboard (port 3000)
- **apps/server** — Hono.js API server (port 3100)
- **packages/db** — Drizzle ORM + PGlite (in-memory dev DB)
- **packages/shared** — Shared TypeScript types + Zod schemas
- **packages/hitl** — XState v5 Human-in-the-Loop Gate Engine
- **packages/context** — Snapshot Manager, Vector Store, Auto-Summarizer
- **packages/tool-policy** — Tool Registry, Permission Matrix, Platform Adapters
- **packages/sandbox** — Docker container management
- **packages/ai** — Vercel AI SDK wrapper, token tracking
- **packages/notifications** — Event dispatcher, Slack/email/push stubs

## Quick Start

```bash
# Install dependencies
pnpm install

# Start infrastructure (Postgres + Valkey)
pnpm infra:up

# Run database migrations
pnpm db:migrate

# Seed dev account
pnpm db:seed

# Start development servers
pnpm dev

# Visit http://localhost:3000
# Login: admin@archon.local / password123
```

## Development

```bash
pnpm typecheck   # TypeScript checks (all packages)
pnpm test:run    # Run all tests once
pnpm lint        # Lint all packages
```

## Phases Implemented

- ✅ Phase 1 — Monorepo + Technical Foundation
- ✅ Phase 2 — Authentication (Better Auth, all auth pages)
- ✅ Phase 3 — Companies + RBAC
- ✅ Phase 4 — Agents, Org Chart, API Keys
- ✅ Phase 5 — Tasks + Tickets
- ✅ Phase 6 — Budgets + BullMQ Scheduler
- ✅ Phase 7 — HITL Gate Engine (XState v5)
- ✅ Phase 8 — Context Intelligence Layer
- ✅ Phase 9 — Tool Policy Engine
- ✅ Phase 10 — Agent Runtime (Docker + Vercel AI SDK + SSE)
- ✅ Phase 11 — Hardening + Tests
