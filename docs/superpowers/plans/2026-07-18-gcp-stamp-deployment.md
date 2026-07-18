# GCP Per-Client Stamp Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take AgencyOS from local-only to a repeatable per-client production deployment on GCP (Cloud Run + Cloud SQL + self-hosted n8n + Vertex AI), driven by one Terraform stamp module and GitHub Actions.

**Architecture:** Each client is a "stamp": a dedicated GCP project holding a Cloud Run app service, a Cloud Run n8n service, a private-IP Cloud SQL Postgres (pgvector), and Secret Manager secrets. A shared ops project holds the Artifact Registry, Terraform state, and Workload Identity Federation for CI. Staging is just another stamp. Images are built once per commit/tag and promoted across stamps.

**Tech Stack:** Next.js 16.2.10 (standalone output), Node 22, Docker multi-stage, drizzle-orm programmatic migrator, Terraform (google provider), GitHub Actions, Cloud Run v2, Cloud SQL Postgres 17, Vertex AI `gemini-embedding-001`, n8n (self-hosted image).

**Spec:** `docs/superpowers/specs/2026-07-18-deployment-stamps-design.md`

**One deviation from the spec, decided here:** the spec says the n8n editor sits behind Identity-Aware Proxy. IAP on Cloud Run requires a load balancer per stamp (cost + moving parts). Equivalent security with less machinery: the n8n service gets **no public invoker** (Cloud Run IAM auth required); the operator reaches the editor via `gcloud run services proxy` (an IAM-authenticated tunnel). n8n's own scheduling (cron nodes) replaces Cloud Scheduler, so nothing external needs to call n8n at all. If a client ever needs browser access for their own staff, add IAP + LB to that one stamp then.

## Global Constraints

- Node `v22.18.0` (`.nvmrc`), npm. Next.js pinned `16.2.10` — **bleeding-edge: read the relevant guide in `node_modules/next/dist/docs/` before touching any Next-specific config or API** (AGENTS.md rule).
- next-auth `^5.0.0-beta.31`, drizzle-orm `^0.45.2`, `postgres` `^3.4.9`, zod `^4.4.3`.
- Required runtime env (from `src/lib/env.ts`): `DATABASE_URL`, `AGENT_API_KEY`, `AUTH_SECRET`. Secrets never committed; production secrets live only in GCP Secret Manager.
- Migrations are **forward-only** (expand-contract). `db:seed` (`src/db/seed.ts`) is dev fixtures — never run against a stamp.
- Tests need a real Postgres **with pgvector** reachable via `DATABASE_URL` (local dev: `postgres://agency:agency@localhost:5433/agency`).
- No Tailwind; semantic CSS design system (ADR-0001) — irrelevant to most tasks here but binding.
- `tsc --noEmit` currently has **4 pre-existing errors** in untouched files (`scripts/migration/report.ts`, two `*.test.ts`). CI therefore gates on lint + tests + build, NOT tsc, until those are fixed (tracked separately).
- GCP region default: `us-central1`. GitHub repo: `rick-sundayai/agencyOS`.
- Commit after every green step; small commits.

---

### Task 1: Programmatic migration entrypoint

Cloud Run Jobs will run migrations; `drizzle-kit` is a dev tool. Use drizzle-orm's programmatic migrator so the job needs no drizzle-kit.

**Files:**
- Create: `scripts/migrate.ts`
- Test: `scripts/migrate.test.ts`

**Interfaces:**
- Consumes: `drizzle/` migrations folder (already exists: `0000_extensions.sql` … `0008_jobdiva-unique.sql`), `getEnv` from `src/lib/env.ts`.
- Produces: `runMigrations(databaseUrl: string): Promise<void>` (exported); CLI behavior: `npx tsx scripts/migrate.ts` migrates the DB at `DATABASE_URL`, exits 0 on success / 1 on failure. Task 4's Docker `migrate` target and Task 9's Cloud Run Job run exactly this command.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/migrate.test.ts
import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../src/lib/env';
import { runMigrations } from './migrate';

describe('runMigrations', () => {
  it('applies all drizzle migrations to a fresh database', async () => {
    const admin = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const dbName = `migrate_test_${Date.now()}`;
    await admin.unsafe(`create database ${dbName}`);
    const freshUrl = getEnv('DATABASE_URL').replace(/\/[^/]+$/, `/${dbName}`);
    try {
      await runMigrations(freshUrl);
      const fresh = postgres(freshUrl, { max: 1 });
      const tables = await fresh`
        select table_name from information_schema.tables where table_schema = 'public'`;
      const names = tables.map((t) => t.table_name);
      expect(names).toContain('decisions');
      expect(names).toContain('candidate_documents');
      expect(names).toContain('embeddings');
      // idempotent: running again is a no-op, not an error
      await runMigrations(freshUrl);
      await fresh.end();
    } finally {
      await admin.unsafe(`drop database ${dbName} with (force)`);
      await admin.end();
    }
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/migrate.test.ts`
Expected: FAIL — `Cannot find module './migrate'` (or "runMigrations is not exported").

- [ ] **Step 3: Write the implementation**

```ts
// scripts/migrate.ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  (async () => {
    const { getEnv } = await import('../src/lib/env');
    await runMigrations(getEnv('DATABASE_URL'));
    console.log('migrations applied');
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Note: no `import 'dotenv/config'` — in Cloud Run env comes from the platform. Local runs already have `.env` loaded by the shell or can use `DATABASE_URL=... npx tsx scripts/migrate.ts`. If local ergonomics matter, mirror `backfill-embeddings.ts` and add the dotenv import — it is a no-op without a `.env` file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/migrate.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite to check for interference**

Run: `npm test`
Expected: 189 tests pass (188 existing + this one). Known flake: `scripts/migration/backfill-embeddings.test.ts` is order-dependent (being fixed in a separate task); if it alone fails, re-run in isolation to confirm.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate.ts scripts/migrate.test.ts
git commit -m "feat: programmatic drizzle migration entrypoint for deploy jobs"
```

---

### Task 2: Configurable connection pool size

`src/db/client.ts` uses the `postgres` default pool (max 10). On Cloud Run, N instances × 10 connections can exhaust a small Cloud SQL tier. Make it an env knob with a safe default.

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `src/db/client.ts` (currently: `const queryClient = postgres(getEnv('DATABASE_URL'));`)
- Test: `src/lib/env.test.ts` (create)

**Interfaces:**
- Produces: `poolMax(value: string | undefined): number` exported from `src/lib/env.ts` — parses `DB_POOL_MAX`, falls back to 10. Task 8 sets `DB_POOL_MAX=5` on the stamp's app service.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/env.test.ts
import { describe, it, expect } from 'vitest';
import { poolMax } from './env';

describe('poolMax', () => {
  it('parses a positive integer', () => {
    expect(poolMax('5')).toBe(5);
  });
  it('defaults to 10 when unset', () => {
    expect(poolMax(undefined)).toBe(10);
  });
  it('defaults to 10 on garbage or non-positive values', () => {
    expect(poolMax('abc')).toBe(10);
    expect(poolMax('0')).toBe(10);
    expect(poolMax('-3')).toBe(10);
    expect(poolMax('2.5')).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/env.test.ts`
Expected: FAIL — `poolMax` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/env.ts`:

```ts
export function poolMax(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 10;
}
```

Replace the client construction in `src/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv, poolMax } from '../lib/env';
import * as schema from './schema';

const queryClient = postgres(getEnv('DATABASE_URL'), {
  max: poolMax(process.env.DB_POOL_MAX),
});
export const db = drizzle(queryClient, { schema });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/env.test.ts && npm test`
Expected: env tests pass; full suite stays green (behavior unchanged when `DB_POOL_MAX` unset).

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts src/db/client.ts
git commit -m "feat: env-configurable db pool size for Cloud Run instances"
```

---

### Task 3: Embedding provider with Vertex AI support

Today `geminiEmbed` is a private function in `scripts/migration/backfill-embeddings.ts` hitting the consumer Gemini API with `GEMINI_API_KEY`. Extract an embedding module that can also call **Vertex AI** (BAA-eligible, service-account auth), selected by env.

**Files:**
- Create: `src/services/embed.ts`
- Test: `src/services/embed.test.ts`
- Modify: `scripts/migration/backfill-embeddings.ts` (delete its private `geminiEmbed`, import from the new module)
- Modify: `package.json` (add dependency `google-auth-library`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (from `src/services/embed.ts`):
  - `type EmbedFn = (text: string) => Promise<number[]>`
  - `makeGeminiApiEmbedder(apiKey: string, fetchFn?: typeof fetch): EmbedFn`
  - `makeVertexEmbedder(opts: { project: string; location: string; tokenFn: () => Promise<string>; fetchFn?: typeof fetch }): EmbedFn`
  - `defaultEmbedder(): EmbedFn` — Vertex when `VERTEX_PROJECT` is set (location from `VERTEX_LOCATION`, default `us-central1`, token via google-auth-library ADC), else Gemini API via `GEMINI_API_KEY`, else throws.
- Both providers use model `gemini-embedding-001` with `outputDimensionality: 3072` (matches the existing `embeddings` table + HNSW index — do NOT change the dimension).

- [ ] **Step 1: Install the auth dependency**

Run: `npm install google-auth-library`
Expected: added to `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing tests**

```ts
// src/services/embed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeGeminiApiEmbedder, makeVertexEmbedder } from './embed';

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

describe('makeGeminiApiEmbedder', () => {
  it('calls the Gemini API with the key header and returns the vector', async () => {
    const fetchFn = vi.fn(async () => okJson({ embedding: { values: [0.1, 0.2] } }));
    const embed = makeGeminiApiEmbedder('test-key', fetchFn as unknown as typeof fetch);
    const vec = await embed('hello');
    expect(vec).toEqual([0.1, 0.2]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-embedding-001:embedContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.outputDimensionality).toBe(3072);
    expect(body.content.parts[0].text).toBe('hello');
  });

  it('throws on a non-OK response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429 }) as Response);
    const embed = makeGeminiApiEmbedder('k', fetchFn as unknown as typeof fetch);
    await expect(embed('x')).rejects.toThrow('embed failed: 429');
  });
});

describe('makeVertexEmbedder', () => {
  it('calls the Vertex predict endpoint with a bearer token and returns the vector', async () => {
    const fetchFn = vi.fn(async () =>
      okJson({ predictions: [{ embeddings: { values: [0.3, 0.4] } }] }),
    );
    const embed = makeVertexEmbedder({
      project: 'client-a',
      location: 'us-central1',
      tokenFn: async () => 'tok-123',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const vec = await embed('hello');
    expect(vec).toEqual([0.3, 0.4]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/client-a/locations/us-central1/publishers/google/models/gemini-embedding-001:predict',
    );
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok-123');
    const body = JSON.parse(init.body as string);
    expect(body.instances[0].content).toBe('hello');
    expect(body.parameters.outputDimensionality).toBe(3072);
  });

  it('throws on a non-OK response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 403 }) as Response);
    const embed = makeVertexEmbedder({
      project: 'p', location: 'us-central1',
      tokenFn: async () => 't', fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(embed('x')).rejects.toThrow('embed failed: 403');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/services/embed.test.ts`
Expected: FAIL — module `./embed` not found.

- [ ] **Step 4: Implement**

```ts
// src/services/embed.ts
export type EmbedFn = (text: string) => Promise<number[]>;

const MODEL = 'gemini-embedding-001';
const DIM = 3072; // must match the embeddings table + HNSW index

export function makeGeminiApiEmbedder(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): EmbedFn {
  return async (text: string) => {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: DIM,
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini embed failed: ${res.status}`);
    return (await res.json()).embedding.values as number[];
  };
}

export function makeVertexEmbedder(opts: {
  project: string;
  location: string;
  tokenFn: () => Promise<string>;
  fetchFn?: typeof fetch;
}): EmbedFn {
  const fetchFn = opts.fetchFn ?? fetch;
  const url =
    `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.project}` +
    `/locations/${opts.location}/publishers/google/models/${MODEL}:predict`;
  return async (text: string) => {
    const token = await opts.tokenFn();
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        instances: [{ content: text }],
        parameters: { outputDimensionality: DIM },
      }),
    });
    if (!res.ok) throw new Error(`vertex embed failed: ${res.status}`);
    return (await res.json()).predictions[0].embeddings.values as number[];
  };
}

export function defaultEmbedder(): EmbedFn {
  const project = process.env.VERTEX_PROJECT;
  if (project) {
    const location = process.env.VERTEX_LOCATION ?? 'us-central1';
    return makeVertexEmbedder({
      project,
      location,
      tokenFn: async () => {
        const { GoogleAuth } = await import('google-auth-library');
        const auth = new GoogleAuth({
          scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });
        const token = await auth.getAccessToken();
        if (!token) throw new Error('vertex embed: no ADC access token');
        return token;
      },
    });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) return makeGeminiApiEmbedder(apiKey);
  throw new Error('embeddings: set VERTEX_PROJECT (prod) or GEMINI_API_KEY (dev)');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/services/embed.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Rewire the backfill script**

In `scripts/migration/backfill-embeddings.ts`: delete the private `geminiEmbed` function and replace its use:

```ts
import { defaultEmbedder } from '../../src/services/embed';
// inside backfillEmbeddings:
const embed = opts.embedFn ?? defaultEmbedder();
```

Leave the `embedFn` injection parameter — the existing tests use it.

- [ ] **Step 7: Run the affected tests and full suite**

Run: `npx vitest run scripts/migration/backfill-embeddings.test.ts && npm test`
Expected: green (backfill tests inject `embedFn`, so no network is hit).

- [ ] **Step 8: Commit**

```bash
git add src/services/embed.ts src/services/embed.test.ts scripts/migration/backfill-embeddings.ts package.json package-lock.json
git commit -m "feat: embedding provider module with Vertex AI support (BAA-eligible path)"
```

---

### Task 4: Standalone Docker build

**Files:**
- Modify: `next.config.ts`
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `scripts/migrate.ts` (Task 1).
- Produces: image targets `runtime` (Next.js server on port 8080) and `migrate` (runs `npx tsx scripts/migrate.ts` and exits). Tasks 8–10 deploy these exact targets.

- [ ] **Step 1: Read the Next docs for this version**

Read `node_modules/next/dist/docs/` sections on `output: "standalone"` and self-hosting/deployment (AGENTS.md: this Next version differs from training data). Confirm the standalone server file name (`server.js`) and static-assets copy layout; adjust Step 3/4 if the docs disagree.

- [ ] **Step 2: Enable standalone output**

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 3: Verify the build produces a standalone server**

Run: `npm run build && ls .next/standalone/server.js`
Expected: build succeeds; `server.js` exists. (Local `.env` supplies the env vars the build imports.)

- [ ] **Step 4: Write `.dockerignore` and `Dockerfile`**

```
# .dockerignore
node_modules
.next
.git
.env*
docs
*.md
.vscode
.claude
```

```dockerfile
# Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# Dummy values: module-level getEnv() calls run during `next build` page-data
# collection. These never reach the runtime image (separate stage).
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    AUTH_SECRET=build-only \
    AGENT_API_KEY=build-only \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- migrate target: full deps + tsx, runs drizzle migrations then exits ---
FROM deps AS migrate
COPY drizzle ./drizzle
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY src/lib/env.ts ./src/lib/env.ts
COPY tsconfig.json ./
CMD ["npx", "tsx", "scripts/migrate.ts"]

# --- runtime target: minimal standalone server ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
```

(If the repo has no `public/` directory, create an empty one with a `.gitkeep` so the COPY succeeds: `mkdir -p public && touch public/.gitkeep`.)

- [ ] **Step 5: Build both targets**

Run:
```bash
docker build --target runtime -t agencyos-app:local .
docker build --target migrate -t agencyos-migrate:local .
```
Expected: both builds succeed.

- [ ] **Step 6: Verify the migrate image against local Postgres**

```bash
docker run --rm \
  -e DATABASE_URL=postgres://agency:agency@host.docker.internal:5433/agency \
  agencyos-migrate:local
```
Expected: `migrations applied`, exit 0 (idempotent — schema already current locally).

- [ ] **Step 7: Verify the runtime image serves the app**

```bash
docker run --rm -d --name agencyos-smoke -p 8080:8080 \
  -e DATABASE_URL=postgres://agency:agency@host.docker.internal:5433/agency \
  -e AUTH_SECRET=$(openssl rand -base64 32) \
  -e AGENT_API_KEY=local-smoke-key \
  -e AUTH_TRUST_HOST=true \
  agencyos-app:local
sleep 3
curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/login
docker rm -f agencyos-smoke
```
Expected: `200` from `/login`. If the login route lives elsewhere, check `src/app` for the auth page path and use that.

- [ ] **Step 8: Commit**

```bash
git add next.config.ts Dockerfile .dockerignore
git add public/.gitkeep || true   # only exists if Step 4 created it
git commit -m "feat: standalone Docker build with runtime and migrate targets"
```

---

### Task 5: Smoke-test script

A post-deploy check that proves a stamp is alive without needing credentials: login page renders, the agent API is up **and** guarded.

**Files:**
- Create: `scripts/smoke.ts`

**Interfaces:**
- Consumes: env `SMOKE_BASE_URL` (e.g. `https://staging.example.com` or `http://localhost:3000`).
- Produces: CLI `npx tsx scripts/smoke.ts` — exit 0 all checks pass, exit 1 with the failing check named. Used by Tasks 9 and 10.

- [ ] **Step 1: Write the script**

```ts
// scripts/smoke.ts
const base = process.env.SMOKE_BASE_URL;
if (!base) {
  console.error('SMOKE_BASE_URL is required');
  process.exit(1);
}

type Check = { name: string; run: () => Promise<void> };

const checks: Check[] = [
  {
    name: 'login page renders (200, html)',
    run: async () => {
      const res = await fetch(`${base}/login`, { redirect: 'follow' });
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('text/html')) throw new Error(`content-type ${type}`);
    },
  },
  {
    name: 'agent API is up and key-guarded (401/403 without key)',
    run: async () => {
      const res = await fetch(`${base}/api/agent/decisions`);
      if (res.status !== 401 && res.status !== 403)
        throw new Error(`expected 401/403, got ${res.status}`);
    },
  },
  {
    name: 'cockpit stream endpoint does not 5xx',
    run: async () => {
      const res = await fetch(`${base}/api/cockpit/stream`, { redirect: 'manual' });
      if (res.status >= 500) throw new Error(`status ${res.status}`);
      // Unauthenticated: any of 401/403/302/307 is fine — proves the route exists.
      await res.body?.cancel();
    },
  },
];

(async () => {
  let failed = 0;
  for (const check of checks) {
    try {
      await check.run();
      console.log(`ok   ${check.name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${check.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: Verify against the local dev server**

Run (with `next dev` running on :3000 — start it if needed):
```bash
SMOKE_BASE_URL=http://localhost:3000 npx tsx scripts/smoke.ts
```
Expected: all three checks `ok`, exit 0. If the agent route's unauthenticated status differs (e.g. it returns 400), read `src/app/api/agent/decisions/route.ts` and adjust the accepted status list to what the guard actually returns — the point is "up, and not open."

- [ ] **Step 3: Verify the failure path**

Run: `SMOKE_BASE_URL=http://localhost:9 npx tsx scripts/smoke.ts; echo "exit=$?"`
Expected: three FAIL lines, `exit=1`.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.ts
git commit -m "feat: post-deploy smoke script (login, guarded agent API, stream)"
```

---

### Task 6: CI workflow — PR checks

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/migrate.ts` (Task 1) to prepare the test database.
- Produces: required status check `ci / test` on PRs.

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/ci.yml
name: ci
on:
  pull_request:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_USER: agency
          POSTGRES_PASSWORD: agency
          POSTGRES_DB: agency
        ports: ["5433:5432"]
        options: >-
          --health-cmd "pg_isready -U agency"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://agency:agency@localhost:5433/agency
      AUTH_SECRET: ci-only-secret
      AGENT_API_KEY: ci-only-agent-key
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - name: Migrate test database
        run: npx tsx scripts/migrate.ts
      - run: npm run lint
      - run: npm test
      - run: npm run build
      # NOTE: `tsc --noEmit` intentionally absent — 4 pre-existing errors in
      # scripts/migration/*.ts. Add it here once those are fixed.
```

- [ ] **Step 2: Push a branch and open a draft PR to exercise it**

```bash
git checkout -b ci-workflow
git add .github/workflows/ci.yml
git commit -m "ci: PR checks — migrate + lint + vitest + build on pgvector service"
git push -u origin ci-workflow
gh pr create --draft --title "ci: PR checks" --body $'Adds PR CI: pgvector service, migrate, lint, vitest, next build.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'
gh run watch --exit-status
```
Expected: the `ci / test` run goes green. If a test needs something the fixtures don't create (e.g. a seed org), read the failing test's fixture setup — tests create their own data via `src/test/fixtures.ts`; do NOT add `db:seed` to CI.

- [ ] **Step 3: Merge the PR**

```bash
gh pr ready && gh pr merge --squash --delete-branch
```
Expected: merged to main; later tasks branch from updated main.

---

### Task 7: Terraform — ops project (registry, state, CI identity)

One-time shared infrastructure. Terraform files are committed; the `apply` is an **operator-run** step (needs org owner + billing permissions — do not run `apply` from an agent session).

**Files:**
- Create: `infra/ops/main.tf`
- Create: `infra/ops/variables.tf`
- Create: `infra/ops/outputs.tf`
- Create: `infra/README.md`

**Interfaces:**
- Produces (consumed by Tasks 8–10): Artifact Registry repo `us-central1-docker.pkg.dev/<ops-project>/agencyos`, GCS state bucket name, WIF provider resource name + deployer SA email (stored as GitHub repo variables `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_AR`, `GCP_REGION`).

- [ ] **Step 1: Write the ops root module**

```hcl
# infra/ops/variables.tf
variable "org_id"          { type = string }
variable "billing_account" { type = string }
variable "ops_project_id"  { type = string  # e.g. "agencyos-ops"
}
variable "region"          { type = string  default = "us-central1" }
variable "github_repo"     { type = string  default = "rick-sundayai/agencyOS" }
```

```hcl
# infra/ops/main.tf
terraform {
  required_version = ">= 1.7"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
  # First apply uses local state; then migrate:
  # terraform init -migrate-state  (uncomment after the bucket exists)
  # backend "gcs" {
  #   bucket = "agencyos-ops-tfstate"
  #   prefix = "ops"
  # }
}

provider "google" {
  project = var.ops_project_id
  region  = var.region
}

resource "google_project" "ops" {
  name            = "AgencyOS Ops"
  project_id      = var.ops_project_id
  org_id          = var.org_id
  billing_account = var.billing_account
  deletion_policy = "PREVENT"
}

resource "google_project_service" "ops" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "iamcredentials.googleapis.com",
    "iam.googleapis.com",
    "storage.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudbilling.googleapis.com",
  ])
  project = google_project.ops.project_id
  service = each.value
}

resource "google_storage_bucket" "tfstate" {
  project                     = google_project.ops.project_id
  name                        = "${var.ops_project_id}-tfstate"
  location                    = "US"
  uniform_bucket_level_access = true
  versioning { enabled = true }
  public_access_prevention = "enforced"
}

resource "google_artifact_registry_repository" "agencyos" {
  project       = google_project.ops.project_id
  location      = var.region
  repository_id = "agencyos"
  format        = "DOCKER"
  depends_on    = [google_project_service.ops]
}

# --- CI identity: GitHub Actions -> GCP via Workload Identity Federation ---
resource "google_service_account" "deployer" {
  project      = google_project.ops.project_id
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = google_project.ops.project_id
  workload_identity_pool_id = "github"
  depends_on                = [google_project_service.ops]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = google_project.ops.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }
  attribute_condition = "assertion.repository == \"${var.github_repo}\""
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  project    = google_project.ops.project_id
  location   = var.region
  repository = google_artifact_registry_repository.agencyos.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}
```

```hcl
# infra/ops/outputs.tf
output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${google_project.ops.project_id}/agencyos"
}
output "tfstate_bucket" { value = google_storage_bucket.tfstate.name }
output "wif_provider"   { value = google_iam_workload_identity_pool_provider.github.name }
output "deployer_sa"    { value = google_service_account.deployer.email }
```

- [ ] **Step 2: Write `infra/README.md`**

```markdown
# AgencyOS infrastructure

Layout:
- `ops/` — shared: Artifact Registry, Terraform state bucket, CI identity (WIF). Applied once.
- `modules/stamp/` — the per-client unit: app + n8n on Cloud Run, Cloud SQL, secrets, monitoring.
- `stamps/<name>/` — one root module per stamp (staging is a stamp). `terraform apply` here creates/updates one client.
- `stamps.json` — machine-readable stamp list consumed by the promote workflow.

Bootstrap order (operator, one time):
1. `cd infra/ops && terraform init && terraform apply` (vars: org_id, billing_account, ops_project_id). First apply uses local state.
2. Uncomment the `backend "gcs"` block, then `terraform init -migrate-state`.
3. Set GitHub repo variables from the outputs:
   `gh variable set GCP_WIF_PROVIDER --body "<wif_provider>"`
   `gh variable set GCP_DEPLOY_SA --body "<deployer_sa>"`
   `gh variable set GCP_AR --body "<artifact_registry>"`
   `gh variable set GCP_REGION --body "us-central1"`
4. Create the staging stamp: see `stamps/staging/`.

Per-stamp secrets (JobDiva creds) go in `stamps/<name>/secrets.auto.tfvars` — **gitignored, never committed**.
```

- [ ] **Step 3: Validate**

Run:
```bash
cd infra/ops && terraform init -backend=false && terraform validate && terraform fmt -check .
```
Expected: `Success! The configuration is valid.` Fix any fmt diffs with `terraform fmt`.

- [ ] **Step 4: Commit**

```bash
git add infra/ops infra/README.md
git commit -m "infra: ops project — artifact registry, tf state, GitHub WIF identity"
```

- [ ] **Step 5 (OPERATOR, not agent): apply and record outputs**

The user runs `terraform apply` per `infra/README.md` steps 1–3 and sets the four GitHub repo variables. Tasks 9–10 are blocked on this.

---

### Task 8: Terraform — the stamp module + staging stamp

**Files:**
- Create: `infra/modules/stamp/variables.tf`
- Create: `infra/modules/stamp/main.tf`
- Create: `infra/modules/stamp/outputs.tf`
- Create: `infra/stamps/staging/main.tf`
- Create: `infra/stamps.json`
- Modify: `.gitignore` (add Terraform + stamp-secrets ignores)

**Interfaces:**
- Consumes: ops outputs (state bucket, artifact registry path, deployer SA).
- Produces per stamp: Cloud Run services `app` (public) and `n8n` (IAM-only), Cloud Run Job `migrate`, Cloud SQL instance with `app` + `n8n` databases, secrets, monitoring. Output `app_url`. Consumed by Tasks 9–10 via `gcloud run deploy app|n8n` / `gcloud run jobs update migrate` in the stamp project.

- [ ] **Step 1: Write the module variables**

```hcl
# infra/modules/stamp/variables.tf
variable "stamp_name"      { type = string } # e.g. "staging", "acme-recruiting"
variable "project_id"      { type = string }
variable "org_id"          { type = string }
variable "folder_id"       { type = string  default = null } # clients/ folder
variable "billing_account" { type = string }
variable "region"          { type = string  default = "us-central1" }
variable "app_image"       { type = string } # full AR path incl. tag
variable "migrate_image"   { type = string }
variable "n8n_image"       { type = string  default = "docker.n8n.io/n8nio/n8n:1.99.1" }
variable "db_tier"         { type = string  default = "db-g1-small" }
variable "deployer_sa"     { type = string } # from ops outputs
variable "alert_email"     { type = string }
variable "custom_domain"   { type = string  default = null }
variable "app_min_instances" { type = number  default = 0 }
variable "jobdiva_client_id" { type = string  sensitive = true  default = "" }
variable "jobdiva_username"  { type = string  sensitive = true  default = "" }
variable "jobdiva_password"  { type = string  sensitive = true  default = "" }
```

- [ ] **Step 2: Write the module body**

```hcl
# infra/modules/stamp/main.tf
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

resource "google_project" "stamp" {
  name            = "AgencyOS ${var.stamp_name}"
  project_id      = var.project_id
  org_id          = var.folder_id == null ? var.org_id : null
  folder_id       = var.folder_id
  billing_account = var.billing_account
  deletion_policy = "PREVENT"
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "compute.googleapis.com",
    "aiplatform.googleapis.com",
    "monitoring.googleapis.com",
  ])
  project = google_project.stamp.project_id
  service = each.value
}

# ---------- network (private services access for Cloud SQL) ----------
resource "google_compute_network" "vpc" {
  project                 = google_project.stamp.project_id
  name                    = "stamp"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "main" {
  project       = google_project.stamp.project_id
  name          = "stamp-${var.region}"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/24"
}

resource "google_compute_global_address" "psa" {
  project       = google_project.stamp.project_id
  name          = "psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa.name]
}

# ---------- database ----------
resource "google_sql_database_instance" "pg" {
  project          = google_project.stamp.project_id
  name             = "agencyos"
  region           = var.region
  database_version = "POSTGRES_17"
  settings {
    tier = var.db_tier
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
  }
  deletion_protection = true
  depends_on          = [google_service_networking_connection.psa]
}

resource "google_sql_database" "app"  { project = google_project.stamp.project_id
  name = "agency" instance = google_sql_database_instance.pg.name }
resource "google_sql_database" "n8n"  { project = google_project.stamp.project_id
  name = "n8n" instance = google_sql_database_instance.pg.name }

resource "random_password" "db_app" { length = 32 special = false }
resource "random_password" "db_n8n" { length = 32 special = false }

resource "google_sql_user" "app" { project = google_project.stamp.project_id
  name = "app" instance = google_sql_database_instance.pg.name password = random_password.db_app.result }
resource "google_sql_user" "n8n" { project = google_project.stamp.project_id
  name = "n8n" instance = google_sql_database_instance.pg.name password = random_password.db_n8n.result }

# ---------- secrets ----------
resource "random_password" "auth_secret"        { length = 44 special = false }
resource "random_password" "agent_api_key"      { length = 44 special = false }
resource "random_password" "n8n_encryption_key" { length = 44 special = false }

locals {
  db_host = google_sql_database_instance.pg.private_ip_address
  secrets = {
    "database-url"       = "postgres://app:${random_password.db_app.result}@${local.db_host}:5432/agency"
    "auth-secret"        = random_password.auth_secret.result
    "agent-api-key"      = random_password.agent_api_key.result
    "n8n-db-password"    = random_password.db_n8n.result
    "n8n-encryption-key" = random_password.n8n_encryption_key.result
    "jobdiva-client-id"  = var.jobdiva_client_id
    "jobdiva-username"   = var.jobdiva_username
    "jobdiva-password"   = var.jobdiva_password
  }
}

resource "google_secret_manager_secret" "s" {
  for_each  = local.secrets
  project   = google_project.stamp.project_id
  secret_id = each.key
  replication { auto {} }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "s" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = each.value
}

# ---------- service accounts ----------
resource "google_service_account" "app" { project = google_project.stamp.project_id
  account_id = "app-runtime" display_name = "AgencyOS app runtime" }
resource "google_service_account" "n8n" { project = google_project.stamp.project_id
  account_id = "n8n-runtime" display_name = "n8n runtime" }

resource "google_secret_manager_secret_iam_member" "app_reads" {
  for_each  = toset(["database-url", "auth-secret", "agent-api-key",
                     "jobdiva-client-id", "jobdiva-username", "jobdiva-password"])
  project   = google_project.stamp.project_id
  secret_id = google_secret_manager_secret.s[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "n8n_reads" {
  for_each  = toset(["n8n-db-password", "n8n-encryption-key", "agent-api-key"])
  project   = google_project.stamp.project_id
  secret_id = google_secret_manager_secret.s[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.n8n.email}"
}

resource "google_project_iam_member" "app_vertex" {
  project = google_project.stamp.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# CI deployer may deploy services/jobs in this stamp
resource "google_project_iam_member" "deployer_run" {
  project = google_project.stamp.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${var.deployer_sa}"
}
resource "google_project_iam_member" "deployer_sa_user" {
  project = google_project.stamp.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${var.deployer_sa}"
}

# ---------- Cloud Run: app ----------
resource "google_cloud_run_v2_service" "app" {
  project  = google_project.stamp.project_id
  name     = "app"
  location = var.region
  template {
    service_account = google_service_account.app.email
    scaling { min_instance_count = var.app_min_instances  max_instance_count = 4 }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.app_image
      ports { container_port = 8080 }
      env { name = "AUTH_TRUST_HOST" value = "true" }
      env { name = "DB_POOL_MAX"     value = "5" }
      env { name = "VERTEX_PROJECT"  value = google_project.stamp.project_id }
      env { name = "VERTEX_LOCATION" value = var.region }
      dynamic "env" {
        for_each = { DATABASE_URL = "database-url", AUTH_SECRET = "auth-secret",
                     AGENT_API_KEY = "agent-api-key" }
        content {
          name = env.key
          value_source { secret_key_ref {
            secret = google_secret_manager_secret.s[env.value].secret_id
            version = "latest"
          } }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.s]
  lifecycle { ignore_changes = [template[0].containers[0].image] } # CI owns the image
}

resource "google_cloud_run_v2_service_iam_member" "app_public" {
  project  = google_project.stamp.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------- Cloud Run: n8n (IAM-only; reach editor via `gcloud run services proxy`) ----------
resource "google_cloud_run_v2_service" "n8n" {
  project  = google_project.stamp.project_id
  name     = "n8n"
  location = var.region
  template {
    service_account = google_service_account.n8n.email
    scaling { min_instance_count = 1  max_instance_count = 1 } # cron triggers need always-on
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.n8n_image
      ports { container_port = 5678 }
      env { name = "DB_TYPE"                value = "postgresdb" }
      env { name = "DB_POSTGRESDB_HOST"     value = local.db_host }
      env { name = "DB_POSTGRESDB_DATABASE" value = "n8n" }
      env { name = "DB_POSTGRESDB_USER"     value = "n8n" }
      env { name = "N8N_DIAGNOSTICS_ENABLED" value = "false" }
      env { name = "AGENCYOS_URL" value = google_cloud_run_v2_service.app.uri }
      dynamic "env" {
        for_each = { DB_POSTGRESDB_PASSWORD = "n8n-db-password",
                     N8N_ENCRYPTION_KEY = "n8n-encryption-key",
                     AGENCYOS_AGENT_API_KEY = "agent-api-key" }
        content {
          name = env.key
          value_source { secret_key_ref {
            secret = google_secret_manager_secret.s[env.value].secret_id
            version = "latest"
          } }
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.s]
  lifecycle { ignore_changes = [template[0].containers[0].image] }
}
# NOTE: no allUsers invoker on n8n — IAM auth required by omission.

# ---------- Cloud Run Job: migrate ----------
resource "google_cloud_run_v2_job" "migrate" {
  project  = google_project.stamp.project_id
  name     = "migrate"
  location = var.region
  template {
    template {
      service_account = google_service_account.app.email
      vpc_access {
        network_interfaces {
          network    = google_compute_network.vpc.id
          subnetwork = google_compute_subnetwork.main.id
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      containers {
        image = var.migrate_image
        env {
          name = "DATABASE_URL"
          value_source { secret_key_ref {
            secret = google_secret_manager_secret.s["database-url"].secret_id
            version = "latest"
          } }
        }
      }
      max_retries = 0
    }
  }
  depends_on = [google_secret_manager_secret_version.s]
  lifecycle { ignore_changes = [template[0].template[0].containers[0].image] }
}

# ---------- domain + monitoring ----------
resource "google_cloud_run_domain_mapping" "app" {
  count    = var.custom_domain == null ? 0 : 1
  project  = google_project.stamp.project_id
  location = var.region
  name     = var.custom_domain
  metadata { namespace = google_project.stamp.project_id }
  spec { route_name = google_cloud_run_v2_service.app.name }
}

resource "google_monitoring_notification_channel" "email" {
  project      = google_project.stamp.project_id
  display_name = "operator email"
  type         = "email"
  labels       = { email_address = var.alert_email }
  depends_on   = [google_project_service.apis]
}

resource "google_monitoring_uptime_check_config" "app" {
  project      = google_project.stamp.project_id
  display_name = "app login"
  timeout      = "10s"
  period       = "300s"
  http_check {
    path         = "/login"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = google_project.stamp.project_id
      host       = replace(google_cloud_run_v2_service.app.uri, "https://", "")
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  project      = google_project.stamp.project_id
  display_name = "app down"
  combiner     = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]
  conditions {
    display_name = "uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.app.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_FRACTION_TRUE"
        cross_series_reducer = "REDUCE_MIN"
      }
    }
  }
}
```

- [ ] **Step 3: Write outputs and the staging root**

```hcl
# infra/modules/stamp/outputs.tf
output "app_url"    { value = google_cloud_run_v2_service.app.uri }
output "project_id" { value = google_project.stamp.project_id }
```

```hcl
# infra/stamps/staging/main.tf
terraform {
  required_version = ">= 1.7"
  backend "gcs" {
    bucket = "agencyos-ops-tfstate" # ops output; adjust if different
    prefix = "stamps/staging"
  }
}

variable "org_id"          { type = string }
variable "billing_account" { type = string }
variable "deployer_sa"     { type = string }
variable "alert_email"     { type = string }
variable "artifact_registry" { type = string } # e.g. us-central1-docker.pkg.dev/agencyos-ops/agencyos

provider "google" {
  region = "us-central1"
}

module "stamp" {
  source          = "../../modules/stamp"
  stamp_name      = "staging"
  project_id      = "agencyos-staging"
  org_id          = var.org_id
  billing_account = var.billing_account
  deployer_sa     = var.deployer_sa
  alert_email     = var.alert_email
  app_image       = "${var.artifact_registry}/app:bootstrap"
  migrate_image   = "${var.artifact_registry}/migrate:bootstrap"
}

output "app_url" { value = module.stamp.app_url }
```

```json
// infra/stamps.json
{
  "stamps": [
    { "name": "staging", "project": "agencyos-staging", "region": "us-central1" }
  ]
}
```

Append to `.gitignore`:

```
# terraform
**/.terraform/
*.tfstate
*.tfstate.*
*.auto.tfvars
```

- [ ] **Step 4: Validate module + staging root**

Run:
```bash
cd infra/stamps/staging && terraform init -backend=false && terraform validate && terraform fmt -check -recursive ../..
```
Expected: `Success! The configuration is valid.` (This also validates the module. Fix the noted `DB_TYPE` typo and any fmt diffs.)

- [ ] **Step 5: Commit**

```bash
git add infra/modules/stamp infra/stamps/staging infra/stamps.json .gitignore
git commit -m "infra: stamp module (app+n8n+sql+secrets+monitoring) and staging stamp"
```

- [ ] **Step 6 (OPERATOR, not agent): create the staging stamp**

User runs, after Task 7's apply and after pushing bootstrap images (Task 9 Step 3 explains the first-image chicken-and-egg): `cd infra/stamps/staging && terraform init && terraform apply` with `org_id`, `billing_account`, `deployer_sa`, `alert_email`, `artifact_registry` supplied via `staging.auto.tfvars` (gitignored) or `TF_VAR_*`.

---

### Task 9: Deploy-to-staging workflow

**Files:**
- Create: `.github/workflows/deploy-staging.yml`

**Interfaces:**
- Consumes: repo variables `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_AR`, `GCP_REGION` (Task 7), staging stamp (Task 8), Docker targets (Task 4), smoke script (Task 5).
- Produces: every merge to main lands on staging, migrated and smoke-tested. Also pushes `app`/`migrate` images tagged with the commit SHA — the artifacts Task 10 promotes.

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/deploy-staging.yml
name: deploy-staging
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency: deploy-staging

env:
  AR: ${{ vars.GCP_AR }}
  REGION: ${{ vars.GCP_REGION }}
  STAGING_PROJECT: agencyos-staging

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
          service_account: ${{ vars.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet

      - name: Build and push images
        run: |
          docker build --target runtime -t "$AR/app:$GITHUB_SHA" .
          docker build --target migrate -t "$AR/migrate:$GITHUB_SHA" .
          docker push "$AR/app:$GITHUB_SHA"
          docker push "$AR/migrate:$GITHUB_SHA"

      - name: Run migrations (Cloud Run Job)
        run: |
          gcloud run jobs update migrate \
            --project "$STAGING_PROJECT" --region "$REGION" \
            --image "$AR/migrate:$GITHUB_SHA"
          gcloud run jobs execute migrate \
            --project "$STAGING_PROJECT" --region "$REGION" --wait

      - name: Deploy app
        run: |
          gcloud run deploy app \
            --project "$STAGING_PROJECT" --region "$REGION" \
            --image "$AR/app:$GITHUB_SHA"

      - name: Smoke test
        run: |
          URL=$(gcloud run services describe app \
            --project "$STAGING_PROJECT" --region "$REGION" \
            --format 'value(status.url)')
          SMOKE_BASE_URL="$URL" npx --yes tsx scripts/smoke.ts
```

- [ ] **Step 2: Commit and push via PR**

```bash
git checkout -b deploy-staging-workflow
git add .github/workflows/deploy-staging.yml
git commit -m "ci: deploy main to the staging stamp (build, migrate job, deploy, smoke)"
git push -u origin deploy-staging-workflow
gh pr create --title "ci: staging deploy workflow" --body $'Build+push per-SHA images, run migrate job, deploy app, smoke test.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'
gh run watch --exit-status   # ci must pass
gh pr merge --squash --delete-branch
```

- [ ] **Step 3 (OPERATOR + agent together): first-deploy bootstrap**

Chicken-and-egg: the stamp's Terraform references `:bootstrap` images, and the workflow needs the stamp to exist. Order on first run:
1. Operator: Task 7 apply; set repo variables.
2. Operator (or agent with gcloud auth): build & push bootstrap images once:
   `docker build --target runtime -t $AR/app:bootstrap . && docker push $AR/app:bootstrap` (same for migrate).
3. Operator: Task 8 Step 6 apply (staging stamp comes up on bootstrap images).
4. Trigger `deploy-staging` via `gh workflow run deploy-staging` — real SHA images deploy, migrate runs, smoke passes.

Expected end state: `deploy-staging` run green; staging URL serves `/login` with HTTP 200.

---

### Task 10: Release tagging + fleet promote workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `.github/workflows/promote.yml`

**Interfaces:**
- Consumes: `infra/stamps.json` (Task 8), per-SHA images (Task 9), repo variables (Task 7).
- Produces: pushing tag `vX.Y.Z` publishes versioned images; `promote` (manual dispatch: `tag`, `stamps` = `all` or comma-list of names) rolls that version across client stamps with migrate-then-deploy-then-smoke per stamp. Rollback = promote the previous tag.

- [ ] **Step 1: Write the release workflow**

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      AR: ${{ vars.GCP_AR }}
      REGION: ${{ vars.GCP_REGION }}
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
          service_account: ${{ vars.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
      - name: Build and push versioned images
        run: |
          TAG="${GITHUB_REF_NAME}"
          docker build --target runtime -t "$AR/app:$TAG" .
          docker build --target migrate -t "$AR/migrate:$TAG" .
          docker push "$AR/app:$TAG"
          docker push "$AR/migrate:$TAG"
```

- [ ] **Step 2: Write the promote workflow**

```yaml
# .github/workflows/promote.yml
name: promote
on:
  workflow_dispatch:
    inputs:
      tag:
        description: "Image tag to promote (e.g. v1.2.0)"
        required: true
      stamps:
        description: "'all' or comma-separated stamp names from infra/stamps.json"
        required: true
        default: "all"

permissions:
  contents: read
  id-token: write

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.select.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
      - id: select
        run: |
          MATRIX=$(node -e '
            const { stamps } = require("./infra/stamps.json");
            const want = "${{ inputs.stamps }}";
            const picked = want === "all"
              ? stamps
              : stamps.filter(s => want.split(",").map(x => x.trim()).includes(s.name));
            if (picked.length === 0) { console.error("no stamps matched"); process.exit(1); }
            console.log("matrix=" + JSON.stringify({ include: picked }));
          ' >> "$GITHUB_OUTPUT"

  rollout:
    needs: plan
    runs-on: ubuntu-latest
    strategy:
      max-parallel: 1   # one stamp at a time; a failure stops the fleet rollout
      fail-fast: true
      matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}
    env:
      AR: ${{ vars.GCP_AR }}
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
          service_account: ${{ vars.GCP_DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Migrate ${{ matrix.name }}
        run: |
          gcloud run jobs update migrate \
            --project "${{ matrix.project }}" --region "${{ matrix.region }}" \
            --image "$AR/migrate:${{ inputs.tag }}"
          gcloud run jobs execute migrate \
            --project "${{ matrix.project }}" --region "${{ matrix.region }}" --wait
      - name: Deploy ${{ matrix.name }}
        run: |
          gcloud run deploy app \
            --project "${{ matrix.project }}" --region "${{ matrix.region }}" \
            --image "$AR/app:${{ inputs.tag }}"
      - name: Smoke ${{ matrix.name }}
        run: |
          URL=$(gcloud run services describe app \
            --project "${{ matrix.project }}" --region "${{ matrix.region }}" \
            --format 'value(status.url)')
          SMOKE_BASE_URL="$URL" npx --yes tsx scripts/smoke.ts
```

- [ ] **Step 3: Commit via PR**

```bash
git checkout -b release-promote-workflows
git add .github/workflows/release.yml .github/workflows/promote.yml
git commit -m "ci: version-tag releases and stamp-by-stamp fleet promotion"
git push -u origin release-promote-workflows
gh pr create --title "ci: release + promote workflows" --body $'Tag push publishes versioned images; promote rolls a tag across stamps sequentially with per-stamp migrate + smoke.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)'
gh run watch --exit-status
gh pr merge --squash --delete-branch
```

- [ ] **Step 4: Verify end-to-end (after staging exists)**

```bash
git tag v0.1.0 && git push origin v0.1.0
gh run watch --exit-status                      # release publishes images
gh workflow run promote -f tag=v0.1.0 -f stamps=staging
gh run watch --exit-status                      # staging migrated+deployed+smoked
```
Expected: both runs green.

---

### Task 11: Deployment runbook

**Files:**
- Create: `docs/deployment.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the operator manual — the document a future teammate reads first.

- [ ] **Step 1: Write the runbook**

```markdown
# AgencyOS deployment runbook

Spec: docs/superpowers/specs/2026-07-18-deployment-stamps-design.md
Infra: infra/ (ops + stamp module). CI: .github/workflows/.

## Onboard a client
1. Copy `infra/stamps/staging/` to `infra/stamps/<client>/`; edit `stamp_name`,
   `project_id` (e.g. `agencyos-acme`), `backend.prefix` (`stamps/<client>`),
   and optionally `custom_domain`, `db_tier`, `app_min_instances`.
2. Put JobDiva creds in `infra/stamps/<client>/secrets.auto.tfvars` (gitignored).
3. `terraform init && terraform apply` in that directory.
4. Add the stamp to `infra/stamps.json`.
5. Promote the current release: `gh workflow run promote -f tag=<tag> -f stamps=<client>`.
6. Create the client's operator user (see "First user").
7. If `custom_domain` is set: add the DNS records `terraform apply` printed.

## First user
There is no signup flow. Insert the operator user directly (bcrypt hash):
run `npx tsx` locally with DATABASE_URL pointed at the stamp via the Cloud SQL
Auth Proxy, and insert into `users` the way `src/db/seed.ts` does — but ONLY the
user row. Never run `db:seed` itself against a stamp.

## Release + promote
- Merge to main → auto-deploys staging (migrate → deploy → smoke).
- Cut a release: `git tag vX.Y.Z && git push origin vX.Y.Z`.
- Roll out: `gh workflow run promote -f tag=vX.Y.Z -f stamps=all` (or a name list).
- Cautious clients: leave them off the list; promote to them later.

## Rollback
`gh workflow run promote -f tag=<previous-tag> -f stamps=<affected>`.
Migrations are forward-only (expand-contract): never write a migration that
breaks the previous app version; removals wait one release after the code
stops using the column.

## n8n editor access
`gcloud run services proxy n8n --project agencyos-<client> --region us-central1 --port 5678`
then open http://localhost:5678. The service has no public access.
n8n workflows call the app at env `AGENCYOS_URL` with header key from
`AGENCYOS_AGENT_API_KEY`.

## Database access (break-glass)
`cloud-sql-proxy agencyos-<client>:us-central1:agencyos` with your IAM user;
credentials for the `app` user are in Secret Manager (`database-url`).
All access is audited via Cloud Audit Logs.

## Offboard a client
1. Final export if contracted (pg_dump via Cloud SQL Auth Proxy).
2. Remove from `infra/stamps.json`.
3. `terraform destroy` in `infra/stamps/<client>/` (flip `deletion_protection`
   on the SQL instance and `deletion_policy` on the project first), or delete
   the GCP project outright — project deletion is the provable data-deletion
   event; record its timestamp for the client.

## Costs (per idle stamp, rough)
Cloud SQL db-g1-small ~$25/mo + n8n min-instance ~$10-15/mo + storage/logs.
App scales to zero unless `app_min_instances = 1`.

## Compliance posture
- All services in the stamp are BAA-coverable (Cloud Run, Cloud SQL, Vertex AI,
  Secret Manager). HIPAA client: execute Google BAA before any PHI enters.
- Secrets only in Secret Manager. No public DB. Least-privilege SAs.
- Embeddings/AI calls stay in the stamp's project via Vertex (`VERTEX_PROJECT`).
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment.md
git commit -m "docs: deployment runbook — onboard, release, rollback, offboard"
```

---

## Execution order & dependencies

```
Task 1 (migrate.ts) ──┬─→ Task 4 (Docker) ──┬─→ Task 9 (staging deploy) ─→ Task 10 (release/promote)
Task 2 (pool)         │                      │
Task 3 (embed/Vertex) │   Task 6 (CI) ───────┤
Task 5 (smoke) ───────┘                      │
Task 7 (ops TF, operator apply) ─────────────┤
Task 8 (stamp TF, operator apply) ───────────┘
Task 11 (runbook) — last
```

Tasks 1, 2, 3, 5 are independent of each other. Operator-run applies (7/8) can proceed in parallel with 9/10 authoring, but 9's first green run needs them done.
