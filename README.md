# Archon — AI Agent Orchestration Platform

A platform for managing teams of autonomous AI agents organized as virtual companies.

## Architecture

- **apps/web** — Next.js 16 App Router dashboard (port 3000)
- **apps/server** — Hono.js API server (port 3010)
- **packages/db** — Drizzle ORM + PGlite (embedded dev DB, no Postgres needed locally)
- **packages/shared** — Shared TypeScript types + Zod schemas
- **packages/hitl** — XState v5 Human-in-the-Loop Gate Engine
- **packages/context** — Snapshot Manager, Vector Store, Auto-Summarizer
- **packages/tool-policy** — Tool Registry, Permission Matrix, Platform Adapters
- **packages/sandbox** — Docker container management
- **packages/ai** — Vercel AI SDK wrapper, token tracking
- **packages/notifications** — Event dispatcher, Slack/email/push stubs

## Local Setup (< 5 min)

### Prerequisites

- **Node.js** ≥ 20 and **pnpm** ≥ 9
- **Docker** (only needed for real agent execution — optional for dev)

```bash
# Install pnpm if you don't have it
npm install -g pnpm
```

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example    apps/web/.env
```

The defaults work for local development. Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3010` | API server port |
| `BETTER_AUTH_SECRET` | (set in .env) | Session secret — generate with `openssl rand -hex 32` |
| `PLATFORM_URL` | `http://localhost:3000` | CORS origin for the web app |
| `VALKEY_URL` | `redis://localhost:6379` | BullMQ job queue (optional — workers disabled if unset) |
| `ANTHROPIC_API_KEY` | — | Required for real Claude agent execution |
| `SLACK_WEBHOOK_URL` | — | Optional: post HITL / budget alerts to Slack |
| `NOTIFY_EMAIL` | — | Optional: send email notifications (requires `RESEND_API_KEY`) |

### 3. Start infra (optional — only if you need BullMQ)

```bash
# Starts a local Valkey (Redis-compatible) instance via Docker
pnpm infra:up
```

If you skip this, the API server still starts and all features work except background job processing (heartbeat scheduling, budget checks).

### 4. Start the servers

```bash
pnpm dev
```

This starts both the API server (`:3010`) and the Next.js app (`:3000`) in parallel.

### 5. Open the dashboard

```
http://localhost:3000
```

Create an account, create a company, and you're ready to go.

---

## Guide: Echo Agent (minimal test)

The echo adapter lets you test the full task→heartbeat flow without Docker or an LLM API key.

1. Create a company in the dashboard.
2. Create an agent with **Adapter type: `http`** and set **Adapter URL** to any public echo endpoint, e.g.:
   ```
   https://httpbin.org/post
   ```
3. Create a task and assign it to the agent.
4. Click **Run heartbeat** on the task detail page (or call the API directly):
   ```bash
   curl -X POST http://localhost:3010/api/companies/<companyId>/agents/<agentId>/heartbeat \
     -H "Cookie: <your-session-cookie>"
   ```
5. Refresh the task — you'll see the heartbeat result posted as a comment.

---

## Guide: Real Claude Code Agent

To run an autonomous Claude Code agent inside a Docker container:

### Prerequisites

- Docker daemon running
- `ANTHROPIC_API_KEY` set in `apps/server/.env`
- Valkey running (`pnpm infra:up`)

### Build the agent image

```bash
docker build -f infra/docker/agent-claude.Dockerfile -t archon-agent-claude:latest .
```

### Create and configure the agent

1. In the dashboard, create a company and then create an agent with:
   - **Adapter type**: `claude_code`
   - **Workspace path**: `/path/to/your/repo` (will be mounted into the container)
2. Generate an API key for the agent.
3. Ensure the agent has the Paperclip skill installed:
   ```bash
   npx paperclipai agent local-cli <agentId> --company-id <companyId>
   ```

### Trigger a heartbeat

Assign a task to the agent and trigger a heartbeat from the dashboard or via:

```bash
curl -X POST http://localhost:3010/api/companies/<companyId>/agents/<agentId>/heartbeat \
  -H "Cookie: <your-session-cookie>"
```

The container will spin up, Claude will run, and results will appear as task comments.

---

## Development

```bash
pnpm typecheck      # TypeScript checks (all packages)
pnpm test:run       # Run all unit tests
pnpm lint           # Lint all packages

# E2E tests (requires dev servers running)
pnpm --filter @archon/web test:e2e
```

## Rate Limits

The API server enforces sliding-window rate limits (backed by Valkey):

| Caller type | Limit |
|---|---|
| Agent API key (`Bearer pf_…`) | 60 req/min |
| Human session | 200 req/min |

Exceeded requests receive `429 Too Many Requests` with a `Retry-After` header.

## Notifications

Key events emit to the in-process notification bus. Configure optional hooks:

| Event | Hook |
|---|---|
| HITL review required | Slack + email |
| Agent paused (budget) | Slack + email |
| Heartbeat failed | Slack |

Set `SLACK_WEBHOOK_URL` and/or `NOTIFY_EMAIL`+`RESEND_API_KEY` to activate.

## Phases Implemented

- ✅ Phase C1 — Monorepo + Technical Foundation
- ✅ Phase C2 — Authentication (Better Auth, all auth pages)
- ✅ Phase C3 — Streaming (SSE heartbeat log, token-by-token output)
- ✅ Phase C4 — HITL Gate (XState v5, approve/reject/escalate)
- ✅ Phase C5 — Docker Runtime (claude_code, codex containers)
- ✅ Phase C6 — Context Intelligence (pgvector snapshots, auto-summarize)
- ✅ Phase C7 — Hardening (rate limiting, retries, pagination, E2E tests)
