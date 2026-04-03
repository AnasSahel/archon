# PRD — Plateforme d'orchestration d'agents IA

**Version** : 2.0  
**Date** : Avril 2026  
**Statut** : En cours de développement  
**Destinataires** : Agents IA (Paperclip), développeurs

---

## Table des matières

1. [Vision et contexte](#1-vision-et-contexte)
2. [Architecture](#2-architecture)
3. [Moteurs (Engines)](#3-moteurs-engines)
4. [Authentification](#4-authentification)
5. [Stack technique et Turborepo](#5-stack-technique-et-turborepo)
6. [Structure du monorepo](#6-structure-du-monorepo)
7. [Environnement local (Docker Compose)](#7-environnement-local-docker-compose)
8. [Modèle de données](#8-modèle-de-données)
9. [Contrats API](#9-contrats-api)
10. [Conventions de développement](#10-conventions-de-développement)
11. [Plan par phases](#11-plan-par-phases)
12. [Workflow local et GitHub](#12-workflow-local-et-github)
13. [Déploiement (optionnel — hors périmètre initial)](#13-déploiement-optionnel--hors-périmètre-initial)

---

## 1. Vision et contexte

### Objectif

Construire une plateforme d'orchestration d'agents IA permettant de gérer des équipes d'agents autonomes organisées en entreprises virtuelles (org chart, budgets, gouvernance). La plateforme améliore les faiblesses identifiées de Paperclip AI : gestion des tokens, Human-in-the-Loop natif, multi-utilisateurs, sandbox d'exécution, et gestion des autorisations d'outils par plateforme.

### Principe de fonctionnement

```
Human (Board/Manager) → crée des objectifs et des tâches
Agents IA (Claude CLI / Codex / OpenCode / HTTP) → exécutent les tâches
Plateforme → orchestre, trace, contrôle les coûts, gère le HITL
```

### Principe de développement

**Visual-first** : chaque phase de développement livre quelque chose de visuellement testable. On commence par ce que l'humain voit et clique, puis on connecte le backend progressivement.

**Feature-complete** : une feature n'est pas terminée tant qu'elle n'est pas testable de bout en bout — UI + API + DB + test. Pas de "UI shell sans backend" livré comme terminé.

**Local-first** : tous les tests se font en local avec Docker Compose. Aucun service cloud externe n'est requis pour développer et tester. Le déploiement sur VPS est une étape ultérieure, hors périmètre des phases actives.

### Ce que la plateforme n'est pas

- Pas un framework de construction d'agents
- Pas un chatbot
- Pas un builder de workflows drag-and-drop
- Pas un gestionnaire de prompts

---

## 2. Architecture

La plateforme est organisée en 6 couches verticales.

```
┌──────────────────────────────────────────────────────────┐
│  COUCHE 1 — Control plane                                │
│  Next.js App Router · Better Auth · RBAC · Tool Config  │
├──────────────────────────────────────────────────────────┤
│  COUCHE 2 — Orchestration core                           │
│  Hono.js · XState HITL · BullMQ · Valkey · Audit log    │
├──────────────────────────────────────────────────────────┤
│  COUCHE 3 — Context intelligence layer                   │
│  Snapshot compressor · pgvector · Auto-summarizer        │
├──────────────────────────────────────────────────────────┤
│  COUCHE 4 — Tool Policy Engine                           │
│  Tool Registry · Permission Matrix · Platform Adapters   │
├──────────────────────────────────────────────────────────┤
│  COUCHE 5 — Agent runtime                                │
│  Execution Mode Router · dockerode · Vercel AI SDK       │
├──────────────────────────────────────────────────────────┤
│  COUCHE 6 — Data layer                                   │
│  PostgreSQL · pgvector · Valkey · S3-compatible          │
└──────────────────────────────────────────────────────────┘
```

### Séparation des process

- `apps/web` (Next.js port 3000) → UI dashboard + légers Route Handlers
- `apps/server` (Hono port 3100) → API lourde, BullMQ workers, Docker, SSE streams

Ces deux process tournent en parallèle. Next.js ne gère jamais de workers de fond.

---

## 3. Moteurs (Engines)

### 3.1 HITL Gate Engine

**Rôle** : Gérer nativement l'état `AWAITING_HUMAN` avec verrou, notifications push, timer et escalade.

**Implémentation** : XState v5 (state machine sérialisable en JSON, persistée en PostgreSQL).

**États** :

```
IDLE → RUNNING → RESULT_READY
                      │
                      ├─ review non requise → IDLE
                      └─ review requise → AWAITING_HUMAN
                                               │
                                               ├─ approve → RUNNING (wake immédiat BullMQ)
                                               ├─ comment → RUNNING (wake immédiat, feedback injecté)
                                               ├─ reject  → RUNNING (wake immédiat, feedback injecté)
                                               └─ timeout → ESCALATED → notif approver N+1
```

**Règles** :
- `AWAITING_HUMAN` : verrou posé en DB (`locked_at`). L'agent ne peut pas checkout de run tant que le verrou existe.
- Timer = BullMQ delayed job (durée configurable par company/agent).
- Human action → lever verrou + enqueue heartbeat priorité haute (< 5 secondes de latence).

**Fichiers** :
- `packages/hitl/src/machine.ts`
- `packages/hitl/src/guards.ts`
- `packages/hitl/src/actions.ts`
- `packages/hitl/src/types.ts`

---

### 3.2 Context Intelligence Layer

**Rôle** : Maintenir le contexte agent à taille constante (~1 500 tokens).

**Trois composants** :

#### Snapshot Manager
Fichier `SNAPSHOT.json` dans le workspace agent.

```typescript
const SNAPSHOT_LIMITS = {
  mission: 200,       // jamais tronqué
  progress: 300,
  decisions: 400,     // archive si > 5 entrées
  artifacts: 300,
  human_feedback: 200,
  context_vars: 150,
  total_target: 1500
}
```

Format :
```json
{
  "schema_version": "1",
  "agent_id": "...",
  "task_id": "...",
  "heartbeat_count": 3,
  "mission": { "company_goal": "", "project_goal": "", "my_role": "", "current_task": "" },
  "progress": { "status": "in_progress", "percent_complete": 40, "completed_steps": [], "next_steps": [] },
  "decisions": [],
  "artifacts": [],
  "human_feedback": [],
  "context_vars": {}
}
```

#### Vector Store (pgvector)
Embeddings des faits importants. Modèle : `nomic-embed-text` via Ollama local. Top-K injectés au heartbeat si pertinents.

#### Auto-Summarizer
Déclenché tous les N heartbeats (défaut : 10). Appelle Claude Haiku via Vercel AI SDK. Le résumé remplace les anciens messages (soft delete DB).

**Fichiers** :
- `packages/context/src/snapshot-manager.ts`
- `packages/context/src/vector-store.ts`
- `packages/context/src/auto-summarizer.ts`

---

### 3.3 Tool Policy Engine

**Rôle** : Contrôler les outils disponibles par agent/rôle et générer la configuration native par plateforme.

**Trois composants** :

#### Tool Registry
Catalogue de tous les outils : MCP servers, skills, commandes shell, web.

#### Permission Matrix
Table `tool_permissions` : `(company_id, agent_role, tool_id, allow)`. Priorité : override agent > override company > défaut rôle.

#### Platform Adapters

| Plateforme | Config générée |
|---|---|
| Claude Code | `.claude/settings.json` avec `allowedTools`, `blockedCommands` |
| Codex CLI | `codex.json` avec `tools` |
| OpenCode | `opencode.json` avec `mcp` |
| HTTP | `tool_manifest` JSON dans le payload heartbeat |

**Fichiers** :
- `packages/tool-policy/src/registry.ts`
- `packages/tool-policy/src/matrix.ts`
- `packages/tool-policy/src/adapters/` (claude-code, codex, opencode, http)
- `packages/tool-policy/src/injector.ts`

---

### 3.4 Agent Runtime

**Rôle** : Exécuter les agents dans des containers Docker isolés, router vers le bon mode d'exécution.

#### Mode local — CLI dans Docker
```
Paperclip Server
  → crée container Docker éphémère
  → injecte API_KEY en env var (jamais exposée au client)
  → monte volume workspace agent
  → exécute Claude CLI / Codex / OpenCode
  → stream stdout → SSE → UI
  → détruit container après exécution
```

**Conformité Anthropic ToS** : L'API key est toujours côté serveur (env var Docker injectée par Paperclip Server). Usage programmatique server-side autorisé.

#### Mode serveur — API directe via Vercel AI SDK
```typescript
const result = await streamText({
  model: getProvider(agent.llm_config),
  messages: buildMessages(snapshot, newMessages),
  onFinish: async ({ usage }) => {
    await trackTokenUsage({ agent_id, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens })
  }
})
```

**Provider Factory** (`packages/ai/src/provider-factory.ts`) :
```typescript
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { createOllama } from 'ollama-ai-provider'

export function getProvider(config: AgentLLMConfig) {
  switch (config.provider) {
    case 'anthropic': return anthropic(config.model)
    case 'openai':    return openai(config.model)
    case 'ollama':    return createOllama({ baseURL: process.env.OLLAMA_BASE_URL })(config.model)
  }
}
```

**Fichiers** :
- `packages/sandbox/src/docker-manager.ts`
- `packages/sandbox/src/container-lifecycle.ts`
- `packages/ai/src/provider-factory.ts`
- `packages/ai/src/token-tracker.ts`
- `packages/ai/src/stream-engine.ts`
- `apps/server/src/runtime/execution-router.ts`

---

### 3.5 Notification Engine

**Canaux** : Slack webhook, Discord webhook, email (Resend), push (ntfy.sh self-hosted).
**Architecture** : Publication Valkey pub/sub → subscriber dans `apps/server` → dispatch canaux.

**Fichiers** :
- `packages/notifications/src/slack.ts`
- `packages/notifications/src/discord.ts`
- `packages/notifications/src/email.ts`
- `packages/notifications/src/push.ts`
- `packages/notifications/src/dispatcher.ts`

---

## 4. Authentification

### 4.1 Vue d'ensemble

| Sujet | Mécanisme | Usage |
|---|---|---|
| Humains | Better Auth — session cookie | Dashboard Next.js |
| Agents | API key Bearer token | Appels HTTP depuis les agents |

### 4.2 Better Auth — Authentification humaine

**Configuration** (`apps/server/src/lib/auth.ts`) :

```typescript
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@repo/db'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 }
  },
  advanced: {
    cookiePrefix: 'platform',
    useSecureCookies: process.env.NODE_ENV === 'production',
  }
})
```

**Tables Better Auth** (auto-gérées) : `users`, `sessions`, `accounts`, `verifications`

**Pages auth** dans `apps/web/app/(auth)/` :
- `/login` — email + password
- `/register` — inscription
- `/forgot-password` — demande reset
- `/reset-password` — nouveau password depuis lien email
- `/verify-email` — confirmation email

**Middleware Next.js** (`apps/web/middleware.ts`) :

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth-client'

const PUBLIC = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']

export async function middleware(request: NextRequest) {
  if (PUBLIC.some(r => request.nextUrl.pathname.startsWith(r))) {
    return NextResponse.next()
  }
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.redirect(new URL('/login', request.url))
  return NextResponse.next()
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] }
```

### 4.3 RBAC — Rôles par company

| Rôle | Permissions |
|---|---|
| `board` | Tout : approve/override/embaucher agents |
| `manager` | Créer/assigner tâches, voir tous les tickets |
| `observer` | Lecture seule |
| `auditor` | Logs et audit trail uniquement |

```typescript
// packages/shared/src/rbac.ts
export type Role = 'board' | 'manager' | 'observer' | 'auditor'

export const PERMISSIONS = {
  'task:create': ['board', 'manager'],
  'task:approve': ['board'],
  'agent:hire': ['board'],
  'agent:terminate': ['board'],
  'budget:override': ['board'],
  'audit:read': ['board', 'auditor'],
} satisfies Record<string, Role[]>

export function can(role: Role, permission: keyof typeof PERMISSIONS): boolean {
  return PERMISSIONS[permission].includes(role)
}
```

### 4.4 API Keys — Authentification des agents

**Format** : `Bearer pf_<32 hex chars>`  
**Stockage** : hash Argon2 en DB. Clé en clair présentée une seule fois à la création.

**Génération** :
```typescript
import { randomBytes } from 'crypto'
import { hash } from '@node-rs/argon2'

export async function generateApiKey(agentId: string, companyId: string, scopes: string[]) {
  const raw = 'pf_' + randomBytes(16).toString('hex')
  const keyHash = await hash(raw, { timeCost: 3, memoryCost: 65536 })
  await db.insert(agentApiKeys).values({
    agent_id: agentId, company_id: companyId,
    key_hash: keyHash, key_prefix: raw.slice(0, 8), scopes
  })
  return { key: raw }  // affiché une seule fois
}
```

**Scopes** : `heartbeat:write`, `task:read`, `task:write`, `snapshot:write`, `skills:read`, `tools:read`

**Middleware Hono** (`apps/server/src/middleware/api-key.ts`) :
```typescript
export const apiKeyMiddleware = async (c: Context, next: Next) => {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('Bearer pf_')) return c.json({ error: 'Unauthorized' }, 401)
  
  const rawKey = authorization.slice(7)
  const prefix = rawKey.slice(0, 8)
  
  const keyRecord = await db.query.agentApiKeys.findFirst({
    where: and(eq(agentApiKeys.key_prefix, prefix), isNull(agentApiKeys.revoked_at)),
    with: { agent: true }
  })
  if (!keyRecord) return c.json({ error: 'Unauthorized' }, 401)
  
  const valid = await argon2Verify({ hash: keyRecord.key_hash, password: rawKey })
  if (!valid) return c.json({ error: 'Unauthorized' }, 401)
  
  c.set('agent', keyRecord.agent)
  c.set('scopes', keyRecord.scopes)
  await next()
}
```

### 4.5 Routes protégées

```typescript
// apps/server/src/routes/index.ts
app.route('/api/health', healthRoutes)              // public
app.route('/api/auth', authRoutes)                  // Better Auth (public)
app.use('/api/*', sessionMiddleware)                // session humaine
app.route('/api/companies', companyRoutes)
app.use('/api/agent/*', apiKeyMiddleware)           // API key agent
app.route('/api/agent/heartbeat', heartbeatRoutes)
app.route('/api/agent/tasks', agentTaskRoutes)
app.route('/api/agent/skills', skillRoutes)
app.route('/api/agent/snapshot', snapshotRoutes)
```

---

## 5. Stack technique et Turborepo

### Turborepo — Configuration

**`turbo.json`** (racine du monorepo) :

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": ["node_modules/.cache/tsbuildinfo.json"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "test:run": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tests/**", "*.test.ts"]
    },
    "test:watch": {
      "cache": false,
      "persistent": true
    },
    "db:generate": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    }
  }
}
```

**`pnpm-workspace.yaml`** :
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**`package.json`** (root) :
```json
{
  "name": "platform",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "test:run": "turbo run test:run",
    "test:watch": "turbo run test:watch",
    "test:e2e": "playwright test",
    "db:generate": "turbo run db:generate --filter=@repo/db",
    "db:migrate": "turbo run db:migrate --filter=@repo/db",
    "db:studio": "turbo run db:studio --filter=@repo/db",
    "db:seed": "turbo run db:seed --filter=@repo/db",
    "infra:up": "docker compose -f infra/docker/docker-compose.dev.yml up -d",
    "infra:down": "docker compose -f infra/docker/docker-compose.dev.yml down",
    "infra:reset": "docker compose -f infra/docker/docker-compose.dev.yml down -v && docker compose -f infra/docker/docker-compose.dev.yml up -d"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "@playwright/test": "^1.44.0"
  },
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

### Stack par couche

| Couche | Technologie | Rôle |
|---|---|---|
| Frontend | Next.js 15 App Router | Dashboard UI |
| Frontend | Better Auth (client) | Session, hooks |
| Frontend | TanStack Query v5 | Server state, cache |
| Frontend | TanStack Form | Formulaires |
| Frontend | TanStack Table | Org chart, tickets, budgets |
| Frontend | Shadcn/ui + Tailwind | Composants, styles |
| Frontend | SSE EventSource | Stream temps réel |
| Backend | Hono.js | Serveur API |
| Backend | XState v5 | HITL Gate Engine |
| Backend | BullMQ | Scheduler, delayed jobs |
| Backend | Valkey | Event bus, queues BullMQ |
| Backend | Zod | Validation schémas |
| Backend | @node-rs/argon2 | Hash API keys |
| LLM | Vercel AI SDK | Abstraction, streaming, tracking |
| LLM | @ai-sdk/anthropic | Claude |
| LLM | @ai-sdk/openai | OpenAI |
| LLM | ollama-ai-provider | Modèles locaux |
| DB | PostgreSQL 16+ | Base principale |
| DB | pgvector | Embeddings |
| DB | Drizzle ORM | Schémas, migrations |
| DB | PGlite | PostgreSQL embarqué (dev/tests) |
| Infra | dockerode | Gestion containers Docker |
| Infra | Resend | Emails transactionnels |
| Tests | Vitest | Tests unitaires/intégration |
| Tests | Playwright | Tests E2E |

---

## 6. Structure du monorepo

```
platform/
├── .github/
│   └── workflows/
│       └── ci.yml                 ← lint + typecheck + tests sur push/PR
├── apps/
│   ├── web/                       ← Next.js 15 App Router (port 3000)
│   │   ├── app/
│   │   │   ├── (auth)/            ← login, register, forgot-password, reset, verify
│   │   │   ├── (dashboard)/       ← routes protégées
│   │   │   │   ├── layout.tsx     ← sidebar + header communs
│   │   │   │   ├── page.tsx       ← home dashboard
│   │   │   │   ├── companies/
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── [id]/
│   │   │   │   │   │   ├── page.tsx         ← overview company
│   │   │   │   │   │   ├── agents/page.tsx  ← org chart
│   │   │   │   │   │   ├── tasks/page.tsx   ← tickets
│   │   │   │   │   │   ├── budgets/page.tsx
│   │   │   │   │   │   └── settings/
│   │   │   │   │   │       ├── members/page.tsx
│   │   │   │   │   │       └── tools/page.tsx
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── ui/                ← Shadcn/ui
│   │   │   ├── auth/              ← LoginForm, RegisterForm...
│   │   │   ├── companies/
│   │   │   ├── agents/            ← OrgChart, AgentCard...
│   │   │   ├── tasks/             ← TaskList, TaskDetail, HitlBadge...
│   │   │   └── stream/            ← SSE consumer, token stream display
│   │   ├── lib/
│   │   │   ├── auth-client.ts     ← Better Auth client
│   │   │   └── api.ts             ← fetch helpers vers apps/server
│   │   ├── middleware.ts
│   │   ├── next.config.ts
│   │   └── package.json
│   ├── server/                    ← Hono.js (port 3100)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── health.ts
│   │   │   │   ├── auth.ts        ← Better Auth handler
│   │   │   │   ├── companies.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── budgets.ts
│   │   │   │   ├── audit.ts
│   │   │   │   ├── stream.ts      ← SSE endpoint
│   │   │   │   └── agent/         ← routes agents (API key auth)
│   │   │   │       ├── heartbeat.ts
│   │   │   │       ├── tasks.ts
│   │   │   │       ├── skills.ts
│   │   │   │       └── snapshot.ts
│   │   │   ├── workers/
│   │   │   │   ├── heartbeat.worker.ts
│   │   │   │   ├── budget-check.worker.ts
│   │   │   │   └── summarizer.worker.ts
│   │   │   ├── middleware/
│   │   │   │   ├── session.ts
│   │   │   │   ├── api-key.ts
│   │   │   │   ├── rate-limit.ts
│   │   │   │   └── logger.ts
│   │   │   ├── lib/
│   │   │   │   ├── auth.ts        ← Better Auth server
│   │   │   │   ├── rbac.ts
│   │   │   │   ├── api-key.ts
│   │   │   │   └── audit.ts
│   │   │   └── runtime/
│   │   │       ├── execution-router.ts
│   │   │       ├── docker-runner.ts
│   │   │       └── api-runner.ts
│   │   └── package.json
│   └── cli/                       ← CLI onboard/configure/issue
│       ├── src/
│       │   ├── commands/
│       │   └── index.ts
│       └── package.json
├── packages/
│   ├── db/                        ← Drizzle ORM
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── users.ts       ← Better Auth
│   │   │   │   ├── companies.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── heartbeats.ts
│   │   │   │   ├── budgets.ts
│   │   │   │   ├── audit-log.ts
│   │   │   │   ├── api-keys.ts
│   │   │   │   ├── tool-registry.ts
│   │   │   │   ├── tool-permissions.ts
│   │   │   │   └── agent-snapshots.ts
│   │   │   ├── migrations/
│   │   │   ├── seed.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── shared/                    ← Types TS + Zod schemas
│   │   ├── src/
│   │   │   ├── types/
│   │   │   ├── schemas/
│   │   │   └── rbac.ts
│   │   └── package.json
│   ├── ai/                        ← Vercel AI SDK wrapper
│   │   ├── src/
│   │   │   ├── provider-factory.ts
│   │   │   ├── token-tracker.ts
│   │   │   └── stream-engine.ts
│   │   └── package.json
│   ├── adapters/                  ← Platform adapters
│   │   ├── src/
│   │   │   ├── claude-code/
│   │   │   ├── codex/
│   │   │   ├── opencode/
│   │   │   └── http/
│   │   └── package.json
│   ├── context/                   ← Context Intelligence Layer
│   │   ├── src/
│   │   │   ├── snapshot-manager.ts
│   │   │   ├── vector-store.ts
│   │   │   └── auto-summarizer.ts
│   │   └── package.json
│   ├── hitl/                      ← HITL Gate Engine
│   │   ├── src/
│   │   │   ├── machine.ts
│   │   │   ├── guards.ts
│   │   │   └── actions.ts
│   │   └── package.json
│   ├── tool-policy/               ← Tool Policy Engine
│   │   ├── src/
│   │   │   ├── registry.ts
│   │   │   ├── matrix.ts
│   │   │   ├── injector.ts
│   │   │   └── adapters/
│   │   └── package.json
│   ├── sandbox/                   ← Docker container management
│   │   ├── src/
│   │   │   ├── docker-manager.ts
│   │   │   └── container-lifecycle.ts
│   │   └── package.json
│   └── notifications/             ← Notification Engine
│       ├── src/
│       │   ├── slack.ts
│       │   ├── email.ts
│       │   ├── push.ts
│       │   └── dispatcher.ts
│       └── package.json
├── infra/
│   └── docker/
│       ├── docker-compose.dev.yml ← services locaux (Postgres, Valkey, Ollama)
│       └── agents/                ← Dockerfiles des agents CLI
│           ├── Dockerfile.claude
│           ├── Dockerfile.codex
│           └── Dockerfile.opencode
├── .env.example
├── .gitignore
├── package.json                   ← workspace root + scripts globaux
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

---

## 7. Environnement local (Docker Compose)

**Tous les tests se font en local.** Aucun service cloud n'est requis pendant le développement.

### `infra/docker/docker-compose.dev.yml`

```yaml
name: platform-dev

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: platform-postgres
    restart: unless-stopped
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: platform_dev
      POSTGRES_USER: platform
      POSTGRES_PASSWORD: platform_dev_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U platform -d platform_dev"]
      interval: 5s
      timeout: 5s
      retries: 5

  valkey:
    image: valkey/valkey:8-alpine
    container_name: platform-valkey
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - valkey_data:/data
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  # Optionnel : modèles LLM locaux (embeddings Nomic, modèles Llama...)
  # Décommenter si Ollama n'est pas installé localement
  # ollama:
  #   image: ollama/ollama:latest
  #   container_name: platform-ollama
  #   ports:
  #     - "11434:11434"
  #   volumes:
  #     - ollama_data:/root/.ollama

volumes:
  postgres_data:
  valkey_data:
  # ollama_data:
```

### Variables d'environnement (`.env.example`)

```env
# ─── Database ────────────────────────────────────────────
# Vide = PGlite embarqué (mode dev zéro-config)
# Rempli = PostgreSQL externe (Docker Compose ou distant)
DATABASE_URL=postgresql://platform:platform_dev_password@localhost:5432/platform_dev
DIRECT_DATABASE_URL=postgresql://platform:platform_dev_password@localhost:5432/platform_dev

# ─── Valkey / Redis ──────────────────────────────────────
VALKEY_URL=redis://localhost:6379

# ─── Better Auth ─────────────────────────────────────────
# Générer avec : openssl rand -hex 32
BETTER_AUTH_SECRET=change_me_generate_with_openssl_rand_hex_32
BETTER_AUTH_URL=http://localhost:3000

# ─── LLM Providers ───────────────────────────────────────
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434

# ─── Email (Resend) ───────────────────────────────────────
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@localhost

# ─── Apps ─────────────────────────────────────────────────
NODE_ENV=development
PLATFORM_URL=http://localhost:3000    # apps/web
SERVER_URL=http://localhost:3100      # apps/server

# ─── Docker ───────────────────────────────────────────────
DOCKER_SOCKET=/var/run/docker.sock

# ─── Storage (optionnel, phase tardive) ──────────────────
# S3_ENDPOINT=
# S3_BUCKET=
# S3_ACCESS_KEY=
# S3_SECRET_KEY=
```

### Démarrage rapide

```bash
# Démarrer l'infra (Postgres + Valkey)
pnpm infra:up

# Vérifier que les services sont sains
docker compose -f infra/docker/docker-compose.dev.yml ps

# Appliquer les migrations
pnpm db:migrate

# Démarrer les apps
pnpm dev
```

---

## 8. Modèle de données

### Tables principales

```typescript
// packages/db/src/schema/companies.ts
export const companies = pgTable('companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  mission: text('mission'),
  settings: jsonb('settings').default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
  deleted_at: timestamp('deleted_at'),
})

// packages/db/src/schema/company-members.ts
export const companyMembers = pgTable('company_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  user_id: text('user_id').notNull(),  // Better Auth user.id
  role: varchar('role', { length: 50 }).notNull(),  // board | manager | observer | auditor
  invited_by: text('invited_by'),
  joined_at: timestamp('joined_at').defaultNow().notNull(),
})

// packages/db/src/schema/agents.ts
export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  parent_agent_id: uuid('parent_agent_id').references((): AnyPgColumn => agents.id),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 255 }).notNull(),
  adapter_type: varchar('adapter_type', { length: 50 }).notNull(),  // claude_code | codex | opencode | http
  llm_config: jsonb('llm_config').notNull(),  // { provider: string, model: string }
  heartbeat_cron: varchar('heartbeat_cron', { length: 100 }),
  monthly_budget_usd: numeric('monthly_budget_usd', { precision: 10, scale: 4 }).default('0'),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  workspace_path: text('workspace_path'),
  skill_ids: uuid('skill_ids').array().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// packages/db/src/schema/tasks.ts
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  agent_id: uuid('agent_id').references(() => agents.id),
  parent_task_id: uuid('parent_task_id').references((): AnyPgColumn => tasks.id),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).notNull().default('open'),
  // open | in_progress | awaiting_human | escalated | done | cancelled
  hitl_state: jsonb('hitl_state'),
  locked_at: timestamp('locked_at'),
  locked_reason: text('locked_reason'),
  review_required_by: timestamp('review_required_by'),
  goal_context: jsonb('goal_context'),
  created_by: text('created_by'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
  completed_at: timestamp('completed_at'),
})

// packages/db/src/schema/task-comments.ts
export const taskComments = pgTable('task_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  task_id: uuid('task_id').notNull().references(() => tasks.id),
  author_type: varchar('author_type', { length: 20 }).notNull(),  // human | agent
  author_id: text('author_id').notNull(),
  content: text('content').notNull(),
  comment_type: varchar('comment_type', { length: 50 }).default('message'),
  // message | review_request | approve | reject | escalate | snapshot
  metadata: jsonb('metadata').default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// packages/db/src/schema/heartbeats.ts
export const heartbeats = pgTable('heartbeats', {
  id: uuid('id').defaultRandom().primaryKey(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  task_id: uuid('task_id').references(() => tasks.id),
  status: varchar('status', { length: 50 }).notNull(),  // running | completed | failed | timeout
  input_tokens: integer('input_tokens').default(0),
  output_tokens: integer('output_tokens').default(0),
  cost_usd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0'),
  snapshot_before: jsonb('snapshot_before'),
  snapshot_after: jsonb('snapshot_after'),
  tool_calls: jsonb('tool_calls').default([]),
  error: text('error'),
  started_at: timestamp('started_at').defaultNow().notNull(),
  completed_at: timestamp('completed_at'),
})

// packages/db/src/schema/agent-budgets.ts
export const agentBudgets = pgTable('agent_budgets', {
  id: uuid('id').defaultRandom().primaryKey(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  period_month: varchar('period_month', { length: 7 }).notNull(),  // "2026-04"
  budget_usd: numeric('budget_usd', { precision: 10, scale: 4 }).notNull(),
  spent_usd: numeric('spent_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).notNull().default('active'),  // active | paused | exceeded
  paused_at: timestamp('paused_at'),
})

// packages/db/src/schema/audit-log.ts
// APPEND-ONLY : aucun UPDATE ni DELETE sur cette table
export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  company_id: uuid('company_id').notNull(),
  entity_type: varchar('entity_type', { length: 100 }).notNull(),
  entity_id: uuid('entity_id').notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  actor_type: varchar('actor_type', { length: 20 }).notNull(),  // human | agent | system
  actor_id: text('actor_id').notNull(),
  diff: jsonb('diff'),
  metadata: jsonb('metadata').default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// packages/db/src/schema/api-keys.ts
export const agentApiKeys = pgTable('agent_api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  key_hash: text('key_hash').notNull(),
  key_prefix: varchar('key_prefix', { length: 8 }).notNull(),  // "pf_a1b2c3" affichage
  scopes: text('scopes').array().notNull().default([]),
  last_used_at: timestamp('last_used_at'),
  expires_at: timestamp('expires_at'),
  revoked_at: timestamp('revoked_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// packages/db/src/schema/tool-registry.ts
export const toolRegistry = pgTable('tool_registry', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull().unique(),
  type: varchar('type', { length: 50 }).notNull(),  // mcp | skill | command | web
  description: text('description'),
  platforms: text('platforms').array().notNull().default([]),
  config_schema: jsonb('config_schema').default({}),
  is_system: boolean('is_system').default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// packages/db/src/schema/tool-permissions.ts
export const toolPermissions = pgTable('tool_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  company_id: uuid('company_id').notNull().references(() => companies.id),
  agent_role: varchar('agent_role', { length: 100 }),  // null = tous les rôles
  agent_id: uuid('agent_id').references(() => agents.id),  // null = par rôle
  tool_id: uuid('tool_id').notNull().references(() => toolRegistry.id),
  allow: boolean('allow').notNull().default(true),
  config_override: jsonb('config_override').default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// packages/db/src/schema/agent-snapshots.ts
export const agentSnapshots = pgTable('agent_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  task_id: uuid('task_id').references(() => tasks.id),
  heartbeat_count: integer('heartbeat_count').notNull().default(0),
  content: jsonb('content').notNull(),
  token_estimate: integer('token_estimate'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})
```

---

## 9. Contrats API

### Endpoints humains (session cookie)

```
GET    /api/health
GET    /api/companies
POST   /api/companies
GET    /api/companies/:id
PATCH  /api/companies/:id
GET    /api/companies/:id/members
POST   /api/companies/:id/members          ← inviter un membre
PATCH  /api/companies/:id/members/:userId  ← changer le rôle
DELETE /api/companies/:id/members/:userId
GET    /api/companies/:id/agents
POST   /api/companies/:id/agents
PATCH  /api/companies/:id/agents/:agentId
DELETE /api/companies/:id/agents/:agentId
POST   /api/companies/:id/agents/:agentId/api-keys   ← générer une clé
GET    /api/companies/:id/agents/:agentId/api-keys   ← lister (préfixes seulement)
DELETE /api/companies/:id/api-keys/:keyId            ← révoquer
GET    /api/companies/:id/tasks
POST   /api/companies/:id/tasks
GET    /api/companies/:id/tasks/:taskId
PATCH  /api/companies/:id/tasks/:taskId
POST   /api/companies/:id/tasks/:taskId/comments
POST   /api/companies/:id/tasks/:taskId/review       ← action HITL humaine
GET    /api/companies/:id/budgets
PATCH  /api/companies/:id/agents/:agentId/budget
GET    /api/companies/:id/audit
GET    /api/companies/:id/tools                      ← tool registry + permissions
PUT    /api/companies/:id/tools/permissions          ← mettre à jour permissions
```

### Endpoints agents (API key Bearer)

```
POST   /api/agent/heartbeat
GET    /api/agent/tasks/next              ← checkout atomique
PATCH  /api/agent/tasks/:taskId
POST   /api/agent/tasks/:taskId/comments
GET    /api/agent/snapshot
POST   /api/agent/snapshot
GET    /api/agent/skills
GET    /api/agent/skills/:name            ← contenu SKILL.md
GET    /api/agent/tools                   ← config native générée
```

### SSE Stream (temps réel)

```
GET    /api/stream/companies/:id
Events:
  heartbeat_started   → { agent_id, task_id, heartbeat_id }
  heartbeat_token     → { heartbeat_id, token: string }
  heartbeat_completed → { heartbeat_id, status, usage }
  task_updated        → { task_id, status, updated_by }
  hitl_gate_triggered → { task_id, agent_id, review_required_by }
  budget_alert        → { agent_id, percent_used, status }
  agent_log           → { agent_id, level, message }
```

---

## 10. Conventions de développement

### TypeScript

- `strict: true` dans tous les `tsconfig.json`
- Pas de `any` — utiliser `unknown` + type guards
- Toutes les entrées API validées par Zod avant usage
- Nommage : `camelCase` variables/fonctions, `PascalCase` types/classes, `UPPER_SNAKE` constantes

### `tsconfig.base.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### Drizzle ORM

- Un fichier par table dans `packages/db/src/schema/`
- Tables en `snake_case` pluriel
- Toujours passer par `packages/db` — jamais de requêtes SQL brutes ailleurs
- Commandes :
  ```bash
  pnpm db:generate   # génère migration
  pnpm db:migrate    # applique migrations
  pnpm db:studio     # Drizzle Studio (UI DB)
  pnpm db:seed       # données de test
  ```

### Git et GitHub

- `main` : production, protégé (merge via PR uniquement)
- `dev` : développement courant
- Feature branches : `feat/nom`
- Fix branches : `fix/description`
- Commits : `type(scope): description` — ex: `feat(hitl): implement XState machine`
- CI doit passer avant tout merge sur `main`

### Tests

- Tests unitaires : `*.test.ts` à côté du fichier testé
- Vitest avec PGlite (pas de Docker requis pour les tests unitaires)
- E2E Playwright : `apps/web/tests/e2e/`
- Commandes :
  ```bash
  pnpm test:run     # tous les tests, une passe
  pnpm test:watch   # mode watch
  pnpm test:e2e     # Playwright (nécessite pnpm dev)
  ```

### Logging

- `pino` uniquement — pas de `console.log` en production
- Format JSON structuré : `{ level, timestamp, service, message, ...context }`

---

## 11. Plan par phases

### Principe

**Visual-first** : chaque phase livre quelque chose de visuellement testable dans le navigateur. On construit l'UI en premier, on câble le backend ensuite.

**Feature-complete** : une feature n'est déclarée terminée que quand elle est testable de bout en bout (UI + API + DB + au moins un test). Pas de "shell vide" livré comme terminé.

**Local uniquement** : tout se teste avec `docker compose` local. Aucun déploiement cloud requis.

---

### Phase 1 — Monorepo + Socle technique

**Durée estimée** : 1 semaine  
**Objectif** : Avoir un monorepo qui démarre, des services locaux, et une page visible.

**Tâches** :

1. Initialiser le monorepo
   - Créer la structure de répertoires décrite en section 6
   - `package.json` root avec `workspaces` et scripts globaux
   - `pnpm-workspace.yaml`
   - `turbo.json` avec toutes les pipelines (build, dev, typecheck, lint, test:run)
   - `tsconfig.base.json`
   - `.gitignore` (node_modules, .next, dist, .env)
   - `.env.example` complet

2. Créer `apps/web` (Next.js 15 App Router)
   - Layout racine avec providers (TanStack Query, Shadcn)
   - Page `/` qui redirige vers `/login`
   - Page `/login` avec formulaire basique (sans logique encore)
   - Page `/dashboard` avec message "En construction"
   - Navigation sidebar vide avec les futurs liens

3. Créer `apps/server` (Hono.js)
   - Serveur minimal port 3100
   - Route `GET /api/health` → `{ status: "ok", timestamp: "..." }`
   - Middleware CORS pour autoriser `localhost:3000`
   - Middleware logger (pino)

4. Créer `packages/db`
   - Drizzle ORM configuré
   - PGlite pour dev sans DATABASE_URL
   - Migration vide initiale
   - Export `db` et types

5. Créer `packages/shared`
   - Types de base : `Company`, `Agent`, `Task`, `Role`
   - Zod schemas communs

6. Docker Compose local
   - `infra/docker/docker-compose.dev.yml` avec PostgreSQL + Valkey
   - `pnpm infra:up` / `pnpm infra:down` / `pnpm infra:reset`

7. CI GitHub
   - `.github/workflows/ci.yml` : lint + typecheck + test:run sur push/PR
   - Utilise PGlite (pas de Postgres en CI)

8. Initialiser le repo Git
   - `git init`, premier commit
   - Créer le repo GitHub, pousser

**Résultat testable** :
```bash
pnpm infra:up
pnpm dev
# → http://localhost:3000 → page login visible
# → http://localhost:3100/api/health → { status: "ok" }
# → pnpm typecheck → 0 erreurs
# → pnpm test:run → tests passent (structure vide)
```

**Critères d'acceptation** :
- [ ] `pnpm dev` démarre sans erreur (web port 3000, server port 3100)
- [ ] Page `/login` visible dans le navigateur
- [ ] `GET /api/health` retourne 200
- [ ] `pnpm typecheck` passe sur tout le monorepo
- [ ] CI GitHub passe sur le premier push

---

### Phase 2 — Authentification complète

**Durée estimée** : 2 semaines  
**Objectif** : Login, register, reset password entièrement fonctionnels et testables.

**Tâches** :

1. Configurer Better Auth dans `apps/server`
   - Installer `better-auth` et `better-auth/adapters/drizzle`
   - Créer `apps/server/src/lib/auth.ts`
   - Route `POST /api/auth/**` (Better Auth handler)
   - Tables Better Auth dans `packages/db/src/schema/` + migration

2. Configurer Better Auth client dans `apps/web`
   - `apps/web/lib/auth-client.ts`
   - Provider session dans layout

3. Pages auth complètes dans `apps/web/app/(auth)/`
   - `/login` : formulaire email + password, gestion d'erreur, redirection post-login
   - `/register` : inscription, validation Zod côté client
   - `/forgot-password` : envoi email de reset
   - `/reset-password` : nouveau mot de passe depuis lien
   - `/verify-email` : confirmation depuis lien

4. Middleware de protection des routes
   - `apps/web/middleware.ts`
   - Redirection `/login` si non authentifié
   - Redirection `/dashboard` si déjà connecté sur `/login`

5. Dashboard shell authentifié
   - Layout avec sidebar (liens companies, tasks, settings)
   - Header avec nom utilisateur + bouton logout
   - Page `/dashboard` → "Bienvenue {nom}" après login

6. Configurer Resend pour les emails
   - Email de vérification
   - Email de reset password
   - Templates HTML simples

7. Tests
   - `apps/server/src/lib/auth.test.ts` : test login, register, session
   - `apps/web/tests/e2e/auth.spec.ts` : parcours Playwright complet

**Résultat testable** :
```bash
# Naviguer sur http://localhost:3000
# → Redirigé vers /login
# → S'inscrire avec email + password
# → Recevoir email de vérification (Resend ou console en dev)
# → Se connecter
# → Voir le dashboard avec son nom
# → Se déconnecter
# → Être redirigé vers /login
```

**Critères d'acceptation** :
- [ ] Inscription → vérification email → connexion : parcours complet OK
- [ ] Les routes `/dashboard/**` redirigent vers `/login` si non connecté
- [ ] Reset password par email fonctionne
- [ ] `pnpm test:e2e` — parcours auth passe
- [ ] Session persiste après refresh de page
- [ ] Logout efface bien la session

---

### Phase 3 — Companies et membres (RBAC)

**Durée estimée** : 2 semaines  
**Objectif** : Créer des companies, inviter des membres avec des rôles, voir la liste.

**Tâches** :

1. Schéma DB
   - Tables `companies` et `company_members` dans `packages/db/src/schema/`
   - Migration
   - Seed : une company de démo avec 2 membres

2. API companies dans `apps/server`
   - `GET /api/companies` (companies de l'utilisateur connecté)
   - `POST /api/companies` (créer)
   - `GET /api/companies/:id`
   - `GET /api/companies/:id/members`
   - `POST /api/companies/:id/members` (inviter)
   - `PATCH /api/companies/:id/members/:userId` (changer rôle)
   - `DELETE /api/companies/:id/members/:userId`
   - RBAC : créer company = authentifié, inviter = board uniquement

3. UI companies dans `apps/web`
   - Page `/companies` : liste des companies de l'utilisateur (cards)
   - Page `/companies/new` : formulaire création
   - Page `/companies/:id` : overview (nom, mission, nb agents, nb membres)
   - Page `/companies/:id/settings/members` : liste membres avec rôles, bouton inviter, changer rôle

4. Sélection de company active
   - Contexte React : company sélectionnée stockée (cookie ou localStorage)
   - Sidebar mise à jour selon la company sélectionnée

5. Tests
   - Tests unitaires API companies (CRUD + RBAC)
   - Test E2E : créer company, inviter membre

**Résultat testable** :
```bash
# Connecté
# → /companies → voir liste vide
# → Créer une company "Acme Corp" avec mission
# → Voir la company dans la liste
# → Ouvrir → onglet Membres
# → Inviter un email comme Manager
# → Vérifier que le membre apparaît avec le bon rôle
# → Changer le rôle → voir la mise à jour immédiate
```

**Critères d'acceptation** :
- [ ] CRUD companies complet depuis l'UI
- [ ] Invitation de membres avec rôles (board, manager, observer, auditor)
- [ ] Un observer ne peut pas inviter de membres (RBAC vérifié côté serveur)
- [ ] Tests unitaires CRUD + RBAC passent
- [ ] Test E2E création company passe

---

### Phase 4 — Agents, org chart et API keys

**Durée estimée** : 2 semaines  
**Objectif** : Créer des agents avec hiérarchie, générer des API keys.

**Tâches** :

1. Schéma DB
   - Tables `agents` et `agent_api_keys` dans `packages/db/src/schema/`
   - Migration
   - Seed : agents démo (CEO, CTO, Engineer)

2. API agents dans `apps/server`
   - CRUD agents
   - `POST /api/companies/:id/agents/:agentId/api-keys` (générer)
   - `GET /api/companies/:id/agents/:agentId/api-keys` (lister préfixes)
   - `DELETE /api/companies/:id/api-keys/:keyId` (révoquer)
   - Middleware `apiKeyMiddleware` dans `apps/server/src/middleware/api-key.ts`

3. UI agents dans `apps/web`
   - Page `/companies/:id/agents` : org chart visuel (arbre hiérarchique)
   - Drawer ou modal "Créer un agent" : nom, rôle, parent, adapter type, LLM config
   - Drawer détail agent : infos, API keys générées, status

4. Org chart visuel
   - Utiliser TanStack Table ou une lib légère (d3-hierarchy ou simple CSS flexbox tree)
   - Chaque nœud = une card agent avec : nom, rôle, status (active/paused)
   - Clic → ouvre le détail

5. Gestion API keys
   - Bouton "Générer une API key" dans le détail agent
   - Afficher la clé en clair une seule fois (avec copie)
   - Liste des clés existantes (préfixe + date création + last used)
   - Bouton révoquer

6. Tests
   - Test unitaire génération + validation API key
   - Test unitaire middleware `apiKeyMiddleware`
   - Test E2E : créer agent → générer API key → tester avec curl

**Résultat testable** :
```bash
# Dans la company "Acme Corp"
# → Créer agent CEO (adapter: http, llm: claude-opus-4-5)
# → Créer agent CTO (parent: CEO)
# → Créer 2 Engineers (parent: CTO)
# → Voir l'org chart avec la hiérarchie
# → Cliquer sur CEO → Générer une API key → Copier
# → Tester :
curl -H "Authorization: Bearer pf_..." http://localhost:3100/api/agent/tasks/next
# → Doit retourner 200 (null si pas de tâche)
```

**Critères d'acceptation** :
- [ ] Org chart affiche la hiérarchie des agents
- [ ] API key générée, affichée une fois, hashée en DB
- [ ] Middleware API key valide correctement (401 si clé invalide)
- [ ] Révocation d'une clé → requête suivante avec cette clé → 401
- [ ] Tests unitaires API key passent

---

### Phase 5 — Tâches et tickets

**Durée estimée** : 2 semaines  
**Objectif** : Créer des tâches, les assigner à des agents, commenter, changer les statuts.

**Tâches** :

1. Schéma DB
   - Tables `tasks`, `task_comments`, `audit_log`
   - Migration
   - Seed : quelques tâches démo

2. API tâches dans `apps/server`
   - CRUD tasks + task_comments
   - Helper `writeAuditEntry()` appelé après chaque mutation
   - Filtres : par status, par agent, par date

3. UI tâches dans `apps/web`
   - Page `/companies/:id/tasks` : liste avec filtres (status, agent assigné)
   - Drawer "Créer une tâche" : titre, description, agent assigné, contexte
   - Page `/companies/:id/tasks/:taskId` : détail complet
     - En-tête : titre, status badge, agent assigné
     - Thread de commentaires (humains + futurs commentaires agents)
     - Formulaire pour ajouter un commentaire
     - Bouton changer le status

4. Status badges visuels
   - `open` → gris
   - `in_progress` → bleu
   - `awaiting_human` → orange (préparer pour Phase 7)
   - `escalated` → rouge
   - `done` → vert
   - `cancelled` → barré

5. Tests
   - Tests CRUD tasks + commentaires
   - Test RBAC (observer ne peut pas créer de tâche)

**Résultat testable** :
```bash
# → Créer une tâche "Analyser les droits IAM Acme"
# → Assigner à l'agent CEO
# → Voir la tâche dans la liste avec status "open"
# → Ouvrir le détail → ajouter un commentaire
# → Changer le status en "in_progress"
# → Voir la tâche triée correctement dans la liste
```

**Critères d'acceptation** :
- [ ] CRUD tâches complet depuis l'UI
- [ ] Thread de commentaires fonctionnel
- [ ] Filtres par status et par agent fonctionnels
- [ ] Chaque mutation → entrée dans `audit_log`
- [ ] Tests CRUD + RBAC passent

---

### Phase 6 — Budgets et scheduler BullMQ

**Durée estimée** : 2 semaines  
**Objectif** : Afficher les budgets par agent, simuler des heartbeats, voir les déductions.

**Tâches** :

1. Schéma DB
   - Tables `heartbeats` et `agent_budgets`
   - Migration
   - Seed : budgets démo pour chaque agent

2. BullMQ dans `apps/server`
   - Connexion à Valkey (depuis `.env`)
   - Worker `heartbeat.worker.ts` : traite les jobs heartbeat
   - Pour l'instant : heartbeat simulé (agent HTTP mock qui retourne un résultat factice)
   - Worker `budget-check.worker.ts` : vérification quotidienne des budgets
   - Scheduler : enqueue le prochain heartbeat selon `agent.heartbeat_cron`

3. Budget tracker
   - Déduire le coût après chaque heartbeat (basé sur nb tokens × tarif modèle)
   - Alerte à 80% : écrire dans `audit_log` + notifier (console pour l'instant)
   - Pause automatique à 100% : `agent.status = 'paused'`
   - Toutes les mises à jour budget = transactions atomiques

4. API budgets
   - `GET /api/companies/:id/budgets` → budgets de tous les agents du mois courant
   - `PATCH /api/companies/:id/agents/:agentId/budget` → override budget (board uniquement)

5. UI budgets dans `apps/web`
   - Page `/companies/:id/budgets` : tableau agents × budget/dépensé/% + barre de progression
   - Alerte visuelle à 80% (badge orange) et 100% (badge rouge + "Pausé")
   - Bouton "Override budget" (board seulement) → modal avec montant

6. Trigger manuel heartbeat (pour test)
   - Bouton "Déclencher heartbeat" dans le détail agent (dev mode uniquement)
   - Simule un heartbeat avec tokens aléatoires → voit la déduction en temps réel

7. Tests
   - Test unitaire budget tracker (déduction, alerte 80%, pause 100%, atomicité)
   - Test unitaire scheduler BullMQ

**Résultat testable** :
```bash
# → Page /budgets
# → Voir les budgets de chaque agent
# → Cliquer "Déclencher heartbeat" sur l'agent CEO
# → Voir le montant dépensé augmenter
# → Configurer un budget bas (ex: $0.01) → déclencher → voir l'agent passer en "Pausé"
# → Override le budget → redémarrer
```

**Critères d'acceptation** :
- [ ] Budgets visibles par agent et par mois
- [ ] Heartbeat simulé → déduction visible immédiatement dans l'UI
- [ ] À 100% du budget, l'agent passe en `paused` (DB + UI)
- [ ] Override budget fonctionne (board uniquement)
- [ ] Test unitaire budget tracker passe (avec transactions atomiques)

---

### Phase 7 — HITL Gate Engine

**Durée estimée** : 3 semaines  
**Objectif** : Cycle HITL complet testable en local : agent bloqué → notif → human approuve → reprise.

**Tâches** :

1. Implémenter `packages/hitl`
   - Machine XState v5 avec tous les états (`IDLE`, `RUNNING`, `AWAITING_HUMAN`, `ESCALATED`)
   - Guards : `isReviewRequired`, `isTimedOut`
   - Actions : `lockTask`, `unlockTask`, `publishHitlEvent`, `enqueueWake`
   - Sérialisation de l'état en JSON → stocké dans `tasks.hitl_state`
   - Tests unitaires de la machine

2. Intégrer dans le worker heartbeat
   - Après chaque heartbeat simulé, évaluer si review requise
   - Si oui : poser verrou (`locked_at`), publier event Valkey, enqueue BullMQ delayed job (timeout)

3. Implémenter `packages/notifications`
   - Slack webhook (configurable par company dans les settings)
   - Email Resend (template "Review requise sur la tâche X")
   - Subscriber Valkey → dispatcher

4. API review humaine dans `apps/server`
   - `POST /api/companies/:id/tasks/:taskId/review`
   - Body : `{ action: 'approve'|'comment'|'reject', content: string }`
   - RBAC : board ou manager uniquement
   - Lever verrou → écrire commentaire → enqueue heartbeat priorité haute → audit log

5. Escalade automatique
   - BullMQ delayed job déclenché au timeout
   - Statut → `escalated`, notif approver N+1 (configurable)

6. UI HITL dans `apps/web`
   - Badge `AWAITING_HUMAN` orange sur la tâche (clignotant)
   - Dans le détail de la tâche : banner "Review requise" + heure limite
   - Boutons Approuver / Commenter / Rejeter (visibles selon rôle)
   - Timer countdown visuel jusqu'à l'escalade
   - Notification dans l'UI quand une tâche passe en HITL (via SSE — préparer le SSE endpoint)

7. Tests
   - Test unitaire machine XState (toutes les transitions)
   - Test unitaire action review (lever verrou, wake immédiat)
   - Test E2E : tâche → HITL → approbation → reprise

**Résultat testable** :
```bash
# → Ouvrir le détail d'une tâche en cours
# → (Simuler) l'agent marque la tâche "awaiting_human"
# → Badge orange apparaît immédiatement
# → Notification Slack envoyée (vérifier dans Slack)
# → Cliquer "Approuver" dans l'UI (en tant que Board)
# → La tâche repasse en "in_progress"
# → Un heartbeat est enqueué immédiatement (vérifier dans Valkey)
# → Sans action dans le délai → statut "escalated"
```

**Critères d'acceptation** :
- [ ] Machine XState : tous les états et transitions couverts par des tests
- [ ] Verrou posé → aucun autre heartbeat ne peut checkout la tâche
- [ ] Notification Slack envoyée en < 10 secondes
- [ ] Approbation → heartbeat déclenché en < 5 secondes
- [ ] Escalade automatique au timeout → notif envoyée
- [ ] Test E2E HITL complet passe

---

### Phase 8 — Context Intelligence Layer

**Durée estimée** : 3 semaines  
**Objectif** : Contexte agent compressé visible dans l'UI, tokens trackés, réduction mesurable.

**Tâches** :

1. pgvector
   - Activer l'extension sur la DB locale : `CREATE EXTENSION IF NOT EXISTS vector`
   - Table `agent_memory` dans `packages/db/src/schema/`
   - Migration Drizzle

2. Implémenter `packages/context/src/snapshot-manager.ts`
   - Lire/écrire `agent_snapshots` en DB
   - Compression automatique selon les limites par section
   - Budget-aware trimming (< 20% budget → contexte réduit 50%)
   - `toPromptString()` pour injection dans le système prompt

3. Implémenter `packages/context/src/vector-store.ts`
   - Embeddings via Ollama (`nomic-embed-text`) — si Ollama non dispo : fallback texte simple
   - Stocker + requête top-K par similarité cosinus

4. Implémenter `packages/context/src/auto-summarizer.ts`
   - BullMQ worker déclenché tous les 10 heartbeats
   - Appel Claude Haiku via Vercel AI SDK
   - Résumé remplace les anciens messages

5. Intégrer dans le worker heartbeat
   - Avant exécution : lire snapshot + vector top-K → injecter en system prompt
   - Après exécution : sauvegarder nouveau snapshot

6. API snapshot dans `apps/server`
   - `GET /api/agent/snapshot` (pour agents)
   - `GET /api/companies/:id/agents/:agentId/snapshot` (pour humains — lecture)

7. UI snapshot dans `apps/web`
   - Onglet "Contexte" dans le détail agent
   - Afficher le snapshot courant (JSON formaté ou vue structurée)
   - Métriques : nb tokens estimés, taille du contexte, heartbeat_count
   - Graphe d'évolution des tokens sur les derniers heartbeats

8. Tests
   - Test unitaire snapshot manager (compression, limites)
   - Test mesurant la réduction tokens sur 20 heartbeats simulés (doit rester < 2000 tokens)

**Résultat testable** :
```bash
# → Onglet "Contexte" d'un agent
# → Lancer 5 heartbeats simulés
# → Voir le snapshot mis à jour à chaque heartbeat
# → Voir la taille des tokens rester stable (pas de croissance linéaire)
# → À heartbeat 10 : voir l'auto-summarizer déclenché (log visible)
```

**Critères d'acceptation** :
- [ ] Snapshot visible et mis à jour dans l'UI
- [ ] Contexte reste < 2000 tokens à partir du 3e heartbeat
- [ ] Auto-summarizer se déclenche au 10e heartbeat
- [ ] Test unitaire compression passe
- [ ] Test 20 heartbeats : tokens stables passe

---

### Phase 9 — Tool Policy Engine

**Durée estimée** : 2 semaines  
**Objectif** : Configurer les permissions d'outils par rôle, générer des configs natives vérifiables.

**Tâches** :

1. Schéma DB
   - Tables `tool_registry` et `tool_permissions`
   - Migration
   - Seed : outils système (bash, sail api, docker, git, sailpoint-isc, web_search...)

2. Implémenter `packages/tool-policy`
   - `registry.ts` : CRUD tool registry
   - `matrix.ts` : évaluation permissions avec cache mémoire (TTL 60s)
   - Adapters : `adapters/claude-code.ts`, `adapters/codex.ts`, `adapters/opencode.ts`, `adapters/http.ts`
   - `injector.ts` : point d'entrée avant chaque heartbeat

3. API tool policy dans `apps/server`
   - `GET /api/companies/:id/tools` → outils + permissions actuelles
   - `PUT /api/companies/:id/tools/permissions` → mettre à jour (board uniquement)
   - `GET /api/agent/tools` → config native générée pour l'agent (API key auth)

4. Intégrer dans le worker heartbeat
   - Avant invocation : appeler `injector.ts` → écrire le fichier de config dans le workspace

5. UI Tool Policy dans `apps/web`
   - Page `/companies/:id/settings/tools`
   - Tableau : lignes = outils, colonnes = rôles
   - Toggle allow/deny par cellule
   - Badge par type d'outil (MCP, Command, Skill, Web)

6. Tests
   - Test unitaire matrix.ts (priorité override agent > company > rôle)
   - Test génération config Claude Code (`.claude/settings.json` correct)

**Résultat testable** :
```bash
# → Page /settings/tools
# → Désactiver "bash" pour le rôle "observer"
# → Vérifier dans l'API :
curl -H "Authorization: Bearer pf_..." http://localhost:3100/api/agent/tools
# → "bash" absent de la config générée pour un agent observer
# → La config .claude/settings.json est générée avec les bons allowedTools
```

**Critères d'acceptation** :
- [ ] UI tool policy : toggle allow/deny fonctionnel
- [ ] Config Claude Code générée correctement selon les permissions
- [ ] Override par agent prioritaire sur le rôle
- [ ] Tests unitaires matrix + adapters passent

---

### Phase 10 — Agent Runtime (le vrai moteur)

**Durée estimée** : 4 semaines  
**Objectif** : Vrai agent s'exécutant dans Docker, tokens en streaming temps réel dans l'UI.

**Tâches** :

1. Implémenter `packages/sandbox`
   - `docker-manager.ts` : créer, démarrer, streamer, arrêter containers
   - `container-lifecycle.ts` : lifecycle complet avec nettoyage en cas d'erreur
   - Network policy : container peut uniquement appeler les URLs whitelistées

2. Créer les Dockerfiles agents dans `infra/docker/agents/`
   - `Dockerfile.claude` : Node.js + Claude CLI installé
   - `Dockerfile.codex` : Node.js + Codex CLI
   - `Dockerfile.opencode` : Node.js + OpenCode
   - Build des images localement : `docker build -t platform-claude infra/docker/agents/ -f Dockerfile.claude`

3. Implémenter `packages/ai`
   - `provider-factory.ts` : Anthropic, OpenAI, Ollama via Vercel AI SDK
   - `token-tracker.ts` : onFinish → mise à jour `heartbeats` + `agent_budgets`
   - `stream-engine.ts` : stream tokens → publish Valkey channel `stream:{heartbeat_id}`

4. SSE endpoint dans `apps/server`
   - `GET /api/stream/companies/:id` → EventSource
   - Subscribe Valkey → push events vers clients SSE connectés
   - Events : `heartbeat_token`, `heartbeat_completed`, `task_updated`, `hitl_gate_triggered`

5. Implémenter `apps/server/src/runtime/execution-router.ts`
   - Router selon `agent.adapter_type`
   - Mode HTTP (mock/test) : appel HTTP simple, pas de Docker
   - Mode CLI (claude_code, codex, opencode) : dockerode → container
   - Mode API directe : Vercel AI SDK

6. UI streaming dans `apps/web`
   - EventSource client dans le composant de suivi heartbeat
   - Affichage des tokens en temps réel (comme un terminal)
   - Indicateur "Agent en cours d'exécution..." avec animation
   - Log des heartbeats dans l'onglet "Activité" de la tâche

7. Agent HTTP echo (pour tests sans Claude)
   - Simple serveur Express/Node qui reçoit un heartbeat et retourne une réponse mockée
   - Permet de tester tout le pipeline sans API key Anthropic
   - Instructions dans le README pour le lancer

8. Tests
   - Test Docker lifecycle (créer → exécuter → nettoyer)
   - Test streaming SSE end-to-end avec agent HTTP echo
   - Test token tracking précis
   - Test E2E complet : tâche → heartbeat → agent echo → stream → résultat

**Résultat testable** :
```bash
# Démarrer un agent HTTP echo en local (instructions README)
# → Créer une tâche assignée à un agent de type HTTP
# → Déclencher un heartbeat
# → Voir les tokens apparaître dans l'UI en temps réel
# → Voir la tâche mise à jour avec le résultat
# → Voir le budget déduit

# Avec Claude CLI (nécessite ANTHROPIC_API_KEY) :
# → Créer un agent type claude_code
# → Déclencher un heartbeat
# → Voir le container Docker créé (docker ps)
# → Voir le streaming Claude dans l'UI
# → Voir le container détruit après exécution
```

**Critères d'acceptation** :
- [ ] Agent HTTP echo : pipeline complet fonctionnel (task → heartbeat → stream → result)
- [ ] Token tracking précis (vérifiable contre la réponse API)
- [ ] Container Docker créé et détruit proprement (pas de zombie containers)
- [ ] API key LLM injectée en env var Docker (jamais dans les logs)
- [ ] Tests E2E complets passent avec l'agent echo

---

### Phase 11 — Hardening local

**Durée estimée** : 2 semaines  
**Objectif** : La plateforme est robuste, testée de bout en bout, prête pour un usage réel.

**Tâches** :

1. Rate limiting
   - Par API key agent : 60 requêtes/minute (Valkey)
   - Par session humaine : 200 requêtes/minute
   - Réponse `429` avec header `Retry-After`

2. Tests Playwright E2E complets
   - Parcours 1 : inscription → créer company → créer agent → créer tâche → HITL → approuver
   - Parcours 2 : générer API key → tester avec agent echo → voir résultat
   - Parcours 3 : configurer tool policy → vérifier config générée

3. Gestion des erreurs frontend
   - Error boundaries React
   - Toast notifications (Shadcn/ui `toast`) pour les succès/erreurs
   - Page 404 et 500 custom

4. Gestion des erreurs backend
   - Global error handler Hono
   - Retry automatique BullMQ (3 tentatives avec backoff exponentiel)
   - Timeout agent (configurable, défaut 10 minutes)

5. Performances
   - Pagination TanStack Table sur les listes (tasks, agents, heartbeats)
   - Index DB sur les colonnes fréquentes (`company_id`, `agent_id`, `status`, `created_at`)
   - Cache TanStack Query avec `staleTime` approprié

6. README complet
   - Prérequis (Node.js 22+, pnpm, Docker)
   - Setup local en < 5 minutes
   - Guide d'ajout d'un agent
   - Guide de contribution

**Résultat testable** :
```bash
# → pnpm test:e2e → tous les parcours passent
# → Test rate limiting : curl en boucle → 429 après 60 req/min
# → Simuler une erreur réseau → voir le toast d'erreur + retry automatique
# → Couper Valkey → voir le message d'erreur approprié
```

**Critères d'acceptation** :
- [ ] Tous les tests Playwright E2E passent
- [ ] Rate limiting actif et testé
- [ ] Aucun zombie container Docker après crash
- [ ] README : setup local < 5 minutes depuis zéro
- [ ] Pagination sur toutes les listes
- [ ] `pnpm test:run` : 0 test en échec

---

## 12. Workflow local et GitHub

### Setup from scratch

```bash
# 1. Prérequis : Node.js 22+, pnpm 9+, Docker Desktop
node --version   # >= 22
pnpm --version   # >= 9
docker --version # >= 24

# 2. Cloner
git clone git@github.com:<org>/<repo>.git
cd platform

# 3. Variables d'environnement
cp .env.example .env
# → Remplir au minimum : BETTER_AUTH_SECRET, ANTHROPIC_API_KEY (si phase 10+)

# 4. Démarrer l'infra
pnpm infra:up
# Attendre que les services soient sains :
docker compose -f infra/docker/docker-compose.dev.yml ps

# 5. Dépendances
pnpm install

# 6. Base de données
pnpm db:migrate
pnpm db:seed   # optionnel : données de démo

# 7. Démarrer
pnpm dev
# → http://localhost:3000  (Next.js)
# → http://localhost:3100  (Hono API)
```

### Commandes courantes

```bash
pnpm dev                 # Tout en watch mode (Turborepo TUI)
pnpm build               # Build prod
pnpm typecheck           # Vérification TypeScript (tout le monorepo)
pnpm lint                # ESLint (tout le monorepo)
pnpm test:run            # Tous les tests Vitest
pnpm test:watch          # Tests en mode watch
pnpm test:e2e            # Tests Playwright (nécessite pnpm dev actif)
pnpm db:generate         # Nouvelle migration Drizzle
pnpm db:migrate          # Appliquer les migrations
pnpm db:studio           # Drizzle Studio (UI DB sur :4983)
pnpm db:seed             # Données de démo
pnpm infra:up            # Démarrer Postgres + Valkey
pnpm infra:down          # Arrêter
pnpm infra:reset         # Arrêter + supprimer volumes + redémarrer
```

### Workflow Git

```bash
# 1. Partir de dev à jour
git checkout dev && git pull origin dev

# 2. Créer une branche
git checkout -b feat/hitl-gate-engine

# 3. Développer, committer régulièrement
git add -p          # review avant commit
git commit -m "feat(hitl): implement XState machine states"

# 4. Pousser
git push origin feat/hitl-gate-engine

# 5. Ouvrir PR sur GitHub → target: dev
# 6. CI doit passer avant merge
# 7. Squash merge sur dev

# Mise en prod (quand dev est stable)
# → PR dev → main → merge → CI passe
```

### CI (`.github/workflows/ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

jobs:
  ci:
    runs-on: ubuntu-latest
    
    services:
      valkey:
        image: valkey/valkey:8-alpine
        ports: ['6379:6379']
        options: --health-cmd "valkey-cli ping" --health-interval 5s

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:run
        env:
          DATABASE_URL: ''           # PGlite embarqué (pas de Postgres en CI)
          VALKEY_URL: redis://localhost:6379
          BETTER_AUTH_SECRET: test_secret_for_ci_only
          NODE_ENV: test
```

---

## 13. Déploiement (optionnel — hors périmètre initial)

Cette section est documentée pour référence future. Elle ne fait pas partie du plan de développement actif. Toutes les phases 1 à 11 se testent et s'exécutent entièrement en local.

### Quand déployer ?

Après la Phase 11, quand la plateforme est stable et testée localement.

### Stack de déploiement recommandée

- **Hôte** : Scaleway Instances ou Elastic Metal (France, data sovereignty)
- **Orchestration** : Dokploy (self-hosted, déjà en place)
- **Secrets** : Infisical self-hosted (déployer avant d'exposer en prod)
- **Container registry** : GitHub Container Registry (`ghcr.io`)
- **PostgreSQL prod** : Scaleway Managed Database PostgreSQL (avec pgvector)
- **Valkey prod** : Scaleway Managed Database Redis-compatible

### Workflow de déploiement

```yaml
# .github/workflows/deploy.yml (à créer en Phase 13)
on:
  push:
    branches: [main]
jobs:
  deploy:
    steps:
      - name: Build & push Docker images
        # → docker build + push vers ghcr.io
      - name: Trigger Dokploy
        # → curl webhook Dokploy
```

---

*Document rédigé pour délégation à des agents IA. Chaque phase est autonome et testable localement avant de passer à la suivante. Les critères d'acceptation permettent à un agent de vérifier la complétion de chaque phase indépendamment.*
