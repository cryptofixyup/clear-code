# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This monorepo contains two independent sub-projects:

- **`nextjs-performance/`** — A production-grade Next.js 15 showcase demonstrating Partial Prerendering, Delta-CRDTs, WebGPU rendering, function-level caching, and memory-aware health checks.
- **`claude-code-skills/`** — A Claude Code skill (style guide) documenting the Claude Code CLI codebase conventions; not an application to run.

---

## nextjs-performance

All commands below must be run from inside `nextjs-performance/`.

### Commands

```bash
# Install dependencies (required before any other step)
npm install

# Patch TypeScript for Typia transforms (required after install and in CI)
npx ts-patch install

# Development server (Turbopack)
npm run dev

# Production build
npm run build

# Start production server (requires prior build)
npm start         # runs: node --expose-gc --max-old-space-size=2048 .next/standalone/server.js

# Type checking (uses tsconfig.ci.json, which excludes server-only modules)
npm run typecheck

# Lint
npm run lint

# Run all unit tests (Vitest)
npm test

# Run tests in watch mode
npm run test:watch

# Run a single test file
npx vitest run tests/delta-crdt.test.ts

# Run tests with coverage
npm run test:coverage
```

CI runs `npx ts-patch install` before `tsc` and `vitest` — if TypeScript patching is skipped locally, Typia-generated validators will fail to compile.

### Architecture

#### Data Flow

```
Client Request
  → middleware.ts          (security headers only; NO auth/authz here)
  → app/ Server Components (auth, authz, row-level security go here)
  → lib/server/            (server-only data access, caching, metrics)
  → API routes             (ingest, sync, SSE streaming, health)
```

#### Key Modules

**`lib/delta-crdt.ts`** — G-Counter CRDT for distributed metric counting. Supports `apply()`, `merge()`, and delta extraction for gossip-based multi-region sync. Produces sub-1KB payloads regardless of scale.

**`lib/memory-health.ts`** — Tracks RSS, heap, and external memory. Triggers manual GC (`global.gc()`) during low-traffic windows when Node is started with `--expose-gc`. Returns HTTP 503 from `/api/health` to signal pod restart when memory exceeds threshold (`MEMORY_GC_THRESHOLD_BYTES`, default 1.5 GB).

**`lib/validation.ts`** — Compile-time schema validation via Typia. Uses branded TypeScript types with validation tags. Typia replaces `typia.createAssert<T>()` calls at build time via the ts-patch transformer (tsc) and `TypiaPlugin` (webpack/Next.js). Do not use Zod here — Typia is intentional for throughput.

**`lib/server/cache.ts`** — Function-level caching using the `'use cache'` directive and `cacheLife()` profiles (`minutes`, `hours`, `weeks`) defined in `next.config.ts`. Imports `server-only` to prevent accidental client bundle inclusion.

**`lib/server/metrics-store.ts`** — In-memory event store with snapshot export. Tested directly by Vitest (no Next.js runtime needed).

**`lib/server/data-access-layer.ts`** — Server-side data access; all queries go through here, not directly from components.

**`components/WebGpuParticles.tsx` / `WebGpuMetricsChart.tsx`** — WebGPU compute shaders for 1M-particle simulation and GPU-rendered time-series charts. Falls back gracefully when WebGPU is unavailable.

**`components/LiveMetricsPanel.tsx`** — Consumes SSE stream from `/api/metrics/stream` and applies CRDT merges on the client.

#### Next.js 15 Experimental Features

Three experimental flags are active in `next.config.ts`:
- **`ppr: true`** — Partial Prerendering. Static shell at the CDN edge; dynamic segments stream via Suspense.
- **`dynamicIO: true`** — Enforces explicit caching boundaries; uncached `fetch()` inside Server Components is a build error.
- **`useCache: true`** — Enables the `'use cache'` directive (stabilized in Next.js 15.3+; still experimental in 15.2.x).

#### Security Invariants

- **Never put auth/authz in `middleware.ts`** — CVE-2025-29927 (fixed in ≥15.2.3) demonstrated that `x-middleware-subrequest` headers can bypass middleware. All authentication and authorization belongs in Server Components.
- Middleware only sets immutable security response headers and handles routing/redirects.
- Sensitive server modules use `import 'server-only'` to prevent client-side bundling.

#### API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/metrics` | GET | Current CRDT counter state |
| `/api/metrics/history` | GET | Time-series data |
| `/api/metrics/stream` | GET | SSE stream for live updates |
| `/api/events` | POST | Ingest metric events |
| `/api/sync` | POST | Multi-region gossip sync |
| `/api/health` | GET | Memory health check (returns 503 if GC threshold exceeded) |

#### Testing

Vitest tests live in `tests/` and cover `lib/` modules only. `lib/server/` is excluded from coverage because those modules import `server-only` and require the Next.js runtime. CI runs tests against Node 20 and Node 22.

#### Environment Variables

```
NEXT_PUBLIC_API_BASE_URL      # External metrics API base URL (optional; stub data used when absent)
MEMORY_GC_THRESHOLD_BYTES     # RSS bytes that trigger GC and eventually 503 (default: 1_500_000_000)
```

Copy `.env.example` to `.env.local` for local development.

#### TypeScript Strictness

`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Path alias `@/*` maps to the project root. `tsconfig.ci.json` is a narrowed config for CI that excludes server-only modules incompatible with plain `tsc`.

---

## claude-code-skills

This directory is a Claude Code skill package — a set of markdown guides describing Claude Code's own internal architecture and coding conventions. It is not a runnable application.

The skill (`SKILL.md`) covers 14 topic areas. The most architecturally significant:

- **Tool Architecture** (`09-tool-architecture.md`) — `buildTool()` factory, tool directory structure, schemas, permissions.
- **Command Architecture** (`10-command-architecture.md`) — Command types, `index.ts` pattern, lazy loading.
- **State Management** (`11-state-management.md`) — Module-level state, getter/setter pattern, AppState threading.
- **Import Conventions** (`03-import-conventions.md`) — `.js` extensions in ESM, `import type`, feature flags via Bun dead-code elimination.

Tech stack described: TypeScript ESM, Node.js, Ink (React for terminals), Zod v4, `@anthropic-ai/sdk`, esbuild.
