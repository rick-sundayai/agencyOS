# UI-Triggered Sourcing with JobDiva Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recruiters trigger candidate sourcing from the UI (JobDiva job-number import on `/jobs`, or a Source button on `/jobs/[id]`); the n8n sourcing workflow searches the internal pool first, falls back to JobDiva only when results are thin, and streams phase progress + the ranked shortlist back onto the job page.

**Architecture:** Orchestration stays in n8n; every capability is a tested TypeScript service behind the existing `/api/agent/*` (agent-key auth) or new `/api/jobs/*` (session auth) surface. A new `sourcing_runs` table tracks each Source click's phase; the job page polls it. Spec: `docs/superpowers/specs/2026-07-20-sourcing-n8n-design.md`.

**Tech Stack:** Next.js 16 App Router, Drizzle + Postgres/pgvector (halfvec 3072), Zod v4, Vitest (real local DB, no mocks), n8n Code-node workflows built by `n8n/build.mjs`, Playwright (new).

## Global Constraints

- **Org scoping (ADR-0006):** never trust a client-supplied `org_id`. Agent routes take org from `requireAgentKey`; session routes from `session.user.org_id`.
- **Per-agent API keys (ADR-0005):** agent routes authenticate via `x-agent-api-key`; never trust a client-supplied actor name.
- **Next.js 16:** `params` and `searchParams` are Promises — `await` them. Read `node_modules/next/dist/docs/` before writing unfamiliar Next.js code.
- **Zod v4 API:** `z.strictObject`, `z.uuid()`, `z.email()` (matches existing services).
- **Tests run against the real local DB** (`.env.local` loaded by vitest `setupFiles: ['dotenv/config']`); use `seedTestAgentInFreshOrg()` for isolation. No DB mocking.
- **UI uses the semantic-CSS token layer** (ADR-0001): existing classes (`detail-panel`, `htile`, `chip`, `card`, `fit-badge`, etc.) — no Tailwind, no inline styles.
- **Embedding model:** `gemini-embedding-001`, 3072 dims, `halfvec(3072)` — every embedding array must be length 3072.
- **Tuning constants (exact values from spec):** `MIN_GOOD_MATCHES = 10`, `MAX_DISTANCE = 0.55`, resume-fetch cap per run `RESUME_FETCH_CAP = 25`, staleness guard `STALE_MINUTES = 10`, UI poll interval 2500 ms.
- **Sourcing run phases (exact strings):** `queued → searching_pool → checking_jobdiva → embedding_new → shortlisting → screening → done | failed`. Terminal: `done`, `failed`.
- **Git:** commit straight to `main` after every task (solo-dev workflow). Commit messages `feat:`/`fix:`/`docs:` style, ending with the Claude co-author trailer.
- **Env vars:** new `N8N_WEBHOOK_URL` (e.g. `http://localhost:5678/webhook`), optional `JOBDIVA_BASE_URL` (default `https://api.jobdiva.com`). Existing: `JOBDIVA_CLIENT_ID`, `JOBDIVA_USERNAME`, `JOBDIVA_PASSWORD`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/sourcing.ts` (new) | `sourcing_runs` table |
| `src/db/schema.ts` (modify) | add barrel re-export |
| `drizzle/0011_*.sql` (generated) | migration |
| `src/services/sourcing-runs.ts` (new) | create/update/read runs; staleness guard; shortlist view |
| `src/services/applications.ts` (new) | bulk upsert `sourced` Applications |
| `src/services/jobdiva.ts` (new) | JobDiva API client (auth, getJob, searchCandidates, getResumeText) |
| `src/services/jobdiva-import.ts` (new) | targeted import: search → dedupe-ingest → embed new resumes |
| `src/services/ingest.ts` (modify) | add `getStoredEmbeddings` reader |
| `src/lib/n8n.ts` (new) | fire the sourcing webhook |
| `src/app/api/agent/sourcing-runs/[id]/route.ts` (new) | PATCH phase/stats/error (agent auth) |
| `src/app/api/agent/applications/route.ts` (new) | POST bulk upsert (agent auth) |
| `src/app/api/agent/jobdiva/import-candidates/route.ts` (new) | POST targeted import (agent auth) |
| `src/app/api/agent/embeddings/route.ts` (modify) | add GET stored-embedding lookup |
| `src/app/api/jobs/import/route.ts` (new) | POST JobDiva job-number import (session auth) |
| `src/app/api/jobs/[id]/source/route.ts` (new) | POST start run / GET run+shortlist (session auth) |
| `src/app/jobs/[id]/SourcingPanel.tsx` (new) | client: Source button, phase progress, shortlist |
| `src/app/jobs/[id]/page.tsx` (modify) | mount panel, pass `?source=1` |
| `src/app/jobs/SourceFromJobDiva.tsx` (new) | client: job-number form |
| `src/app/jobs/page.tsx` (modify) | mount form |
| `n8n/workflows/src/helpers.js` (modify) | `apiPatch`, `updateRun`, tuning constants |
| `n8n/workflows/src/sourcing.workflow.mjs` (modify) | run phases, hash-skip job embed, thin check, applications upsert |
| `n8n/tests/sourcing-screening.sh` (modify) | phase progression + JobDiva soft-fail assertions |
| `playwright.config.ts`, `e2e/*` , `scripts/e2e/fake-n8n.mjs` (new) | e2e setup, fixture stub server, 2 journeys |
| `scripts/jobdiva-smoke.ts` (new) | manual live-API check (not CI) |
| `.env.example`, `CONTEXT.md` (modify) | env vars; Sourcing Run glossary entry |

---

### Task 1: `sourcing_runs` schema + migration

**Files:**
- Create: `src/db/schema/sourcing.ts`
- Modify: `src/db/schema.ts`
- Generated: `drizzle/0011_*.sql`

**Interfaces:**
- Produces: `sourcing_runs` Drizzle table with columns `id, org_id, job_order_id, requested_by, phase, stats, error, created_at, updated_at`. Exported from `src/db/schema` barrel as `sourcing_runs`.

- [ ] **Step 1: Write the schema**

Create `src/db/schema/sourcing.ts`:

```ts
import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs, users } from './core';
import { job_orders } from './ats';

// One row per Source click (or orchestrator-triggered run). `phase` is advanced by the
// n8n sourcing workflow via PATCH /api/agent/sourcing-runs/:id; the job page polls it.
export const sourcing_runs = pgTable('sourcing_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  job_order_id: uuid('job_order_id').notNull().references(() => job_orders.id),
  requested_by: uuid('requested_by').references(() => users.id),
  // queued | searching_pool | checking_jobdiva | embedding_new | shortlisting | screening | done | failed
  phase: text('phase').notNull().default('queued'),
  stats: jsonb('stats').notNull().default(sql`'{}'::jsonb`),
  error: text('error'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

Note: check `src/db/schema/core.ts` — if the users table export is named differently (e.g. `users`), match it; if there is no users export, drop the `.references()` on `requested_by` and keep it a plain `uuid` column.

- [ ] **Step 2: Add the barrel export**

In `src/db/schema.ts`, add alongside the existing re-exports:

```ts
export * from './schema/sourcing';
```

- [ ] **Step 3: Generate and run the migration**

Run: `npm run db:generate` — expect a new `drizzle/0011_*.sql` containing `CREATE TABLE "sourcing_runs"`.
Run: `npm run db:migrate` — expect it to apply cleanly.
Verify: `docker compose exec -T db psql -U agency -c '\d sourcing_runs'` shows the columns.

- [ ] **Step 4: Run the existing suite to confirm nothing broke**

Run: `npm test`
Expected: PASS (the pre-existing `scripts/migration/backfill-embeddings.test.ts` occasionally flakes — known issue, unrelated).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/sourcing.ts src/db/schema.ts drizzle/
git commit -m "feat: add sourcing_runs table tracking UI-triggered sourcing progress"
```

---

### Task 2: sourcing-runs service

**Files:**
- Create: `src/services/sourcing-runs.ts`
- Test: `src/services/sourcing-runs.test.ts`

**Interfaces:**
- Consumes: `sourcing_runs` table (Task 1).
- Produces:
  - `type SourcingPhase = 'queued' | 'searching_pool' | 'checking_jobdiva' | 'embedding_new' | 'shortlisting' | 'screening' | 'done' | 'failed'`
  - `TERMINAL_PHASES: ReadonlySet<SourcingPhase>` (`done`, `failed`)
  - `STALE_MINUTES = 10`
  - `createSourcingRun(input: { org_id: string; job_order_id: string; requested_by: string | null }): Promise<{ created: true; run: SourcingRunRow } | { created: false; active: SourcingRunRow }>` — refuses while a non-terminal run exists for the job (advisory-lock serialized).
  - `updateSourcingRun(orgId: string, id: string, patch: { phase?: SourcingPhase; stats?: Record<string, unknown>; error?: string | null }): Promise<SourcingRunRow | null>` — `stats` is jsonb-merged (`||`), not replaced; bumps `updated_at`; returns null when not found in org.
  - `getLatestSourcingRun(orgId: string, jobOrderId: string): Promise<SourcingRunRow | null>` — latest by `created_at`; a non-terminal run with `updated_at` older than `STALE_MINUTES` is persisted to `failed` ("timed out") before returning.
  - `type SourcingRunRow = typeof sourcing_runs.$inferSelect`

- [ ] **Step 1: Write the failing tests**

Create `src/services/sourcing-runs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { job_orders, sourcing_runs } from '../db/schema';
import { seedTestAgentInFreshOrg } from '../test-support/seed-agent';
import {
  createSourcingRun, updateSourcingRun, getLatestSourcingRun, TERMINAL_PHASES,
} from './sourcing-runs';

async function seedJob(orgId: string): Promise<string> {
  const [row] = await db.insert(job_orders).values({
    org_id: orgId, title: `Test Job ${randomUUID()}`, kind: 'contract',
  }).returning();
  return row.id;
}

describe('createSourcingRun', () => {
  it('creates a queued run', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const res = await createSourcingRun({ org_id: orgId, job_order_id: jobId, requested_by: null });
    expect(res.created).toBe(true);
    if (res.created) expect(res.run.phase).toBe('queued');
  });

  it('refuses while a non-terminal run exists, allows after terminal', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const first = await createSourcingRun({ org_id: orgId, job_order_id: jobId, requested_by: null });
    expect(first.created).toBe(true);

    const second = await createSourcingRun({ org_id: orgId, job_order_id: jobId, requested_by: null });
    expect(second.created).toBe(false);

    if (first.created) await updateSourcingRun(orgId, first.run.id, { phase: 'done' });
    const third = await createSourcingRun({ org_id: orgId, job_order_id: jobId, requested_by: null });
    expect(third.created).toBe(true);
  });
});

describe('updateSourcingRun', () => {
  it('merges stats and sets phase; scoped to org', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const res = await createSourcingRun({ org_id: orgId, job_order_id: jobId, requested_by: null });
    if (!res.created) throw new Error('expected created');

    const a = await updateSourcingRun(orgId, res.run.id, {
      phase: 'searching_pool', stats: { pool_matches: 3 },
    });
    expect(a?.phase).toBe('searching_pool');
    const b = await updateSourcingRun(orgId, res.run.id, { stats: { jobdiva_found: 7 } });
    expect(b?.stats).toMatchObject({ pool_matches: 3, jobdiva_found: 7 });

    const cross = await updateSourcingRun(other.orgId, res.run.id, { phase: 'done' });
    expect(cross).toBeNull();
  });
});

describe('getLatestSourcingRun', () => {
  it('returns the latest run', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const r1 = await createSourcingRun({ org_id: orgId, job_order_id: jobId, requested_by: null });
    if (!r1.created) throw new Error('expected created');
    await updateSourcingRun(orgId, r1.run.id, { phase: 'failed', error: 'x' });
    const r2 = await createSourcingRun({ org_id: orgId, job_order_id: jobId, requested_by: null });
    if (!r2.created) throw new Error('expected created');

    const latest = await getLatestSourcingRun(orgId, jobId);
    expect(latest?.id).toBe(r2.run.id);
  });

  it('fails a stale non-terminal run (timed out)', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const res = await createSourcingRun({ org_id: orgId, job_order_id: jobId, requested_by: null });
    if (!res.created) throw new Error('expected created');
    // Backdate updated_at past the staleness window.
    await db.update(sourcing_runs)
      .set({ updated_at: new Date(Date.now() - 11 * 60_000) })
      .where(eq(sourcing_runs.id, res.run.id));

    const latest = await getLatestSourcingRun(orgId, jobId);
    expect(latest?.phase).toBe('failed');
    expect(latest?.error).toMatch(/timed out/i);
    expect(TERMINAL_PHASES.has('failed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/sourcing-runs.test.ts`
Expected: FAIL — `Cannot find module './sourcing-runs'`.

- [ ] **Step 3: Write the service**

Create `src/services/sourcing-runs.ts`:

```ts
import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { sourcing_runs } from '../db/schema';

export type SourcingPhase =
  | 'queued' | 'searching_pool' | 'checking_jobdiva' | 'embedding_new'
  | 'shortlisting' | 'screening' | 'done' | 'failed';

export const TERMINAL_PHASES: ReadonlySet<SourcingPhase> = new Set(['done', 'failed']);

/** A non-terminal run untouched this long is presumed dead (n8n crashed before its
 * failure handler could run) and is persisted to 'failed' on read. */
export const STALE_MINUTES = 10;

export type SourcingRunRow = typeof sourcing_runs.$inferSelect;

const TERMINAL = ['done', 'failed'] as const;

export async function createSourcingRun(input: {
  org_id: string; job_order_id: string; requested_by: string | null;
}): Promise<{ created: true; run: SourcingRunRow } | { created: false; active: SourcingRunRow }> {
  // Advisory lock serializes concurrent Source clicks for the same job — without it,
  // two clicks can both see "no active run" and both insert.
  return db.transaction(async (tx) => {
    const lockKey = `${input.org_id}|sourcing:${input.job_order_id}`;
    await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const [active] = await tx.select().from(sourcing_runs).where(and(
      eq(sourcing_runs.org_id, input.org_id),
      eq(sourcing_runs.job_order_id, input.job_order_id),
      dsql`${sourcing_runs.phase} not in ('done', 'failed')`,
    )).orderBy(desc(sourcing_runs.created_at)).limit(1);
    if (active) return { created: false as const, active };

    const [run] = await tx.insert(sourcing_runs).values({
      org_id: input.org_id, job_order_id: input.job_order_id,
      requested_by: input.requested_by,
    }).returning();
    return { created: true as const, run };
  });
}

export async function updateSourcingRun(
  orgId: string, id: string,
  patch: { phase?: SourcingPhase; stats?: Record<string, unknown>; error?: string | null },
): Promise<SourcingRunRow | null> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.phase !== undefined) set.phase = patch.phase;
  if (patch.error !== undefined) set.error = patch.error;
  if (patch.stats !== undefined) {
    set.stats = dsql`${sourcing_runs.stats} || ${JSON.stringify(patch.stats)}::jsonb`;
  }
  const [row] = await db.update(sourcing_runs).set(set)
    .where(and(eq(sourcing_runs.org_id, orgId), eq(sourcing_runs.id, id)))
    .returning();
  return row ?? null;
}

export async function getLatestSourcingRun(
  orgId: string, jobOrderId: string,
): Promise<SourcingRunRow | null> {
  const [row] = await db.select().from(sourcing_runs).where(and(
    eq(sourcing_runs.org_id, orgId),
    eq(sourcing_runs.job_order_id, jobOrderId),
  )).orderBy(desc(sourcing_runs.created_at)).limit(1);
  if (!row) return null;

  const isTerminal = (TERMINAL as readonly string[]).includes(row.phase);
  const staleMs = STALE_MINUTES * 60_000;
  if (!isTerminal && Date.now() - row.updated_at.getTime() > staleMs) {
    return updateSourcingRun(orgId, row.id, {
      phase: 'failed', error: 'Sourcing run timed out — the agent runtime stopped reporting progress.',
    });
  }
  return row;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/sourcing-runs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/sourcing-runs.ts src/services/sourcing-runs.test.ts
git commit -m "feat: sourcing-runs service with active-run guard and staleness timeout"
```

---

### Task 3: agent PATCH route for run progress

**Files:**
- Create: `src/app/api/agent/sourcing-runs/[id]/route.ts`
- Test: `src/app/api/agent/sourcing-runs/[id]/route.test.ts`

**Interfaces:**
- Consumes: `requireAgentKey` (`src/lib/agent-auth.ts`), `updateSourcingRun` (Task 2).
- Produces: `PATCH /api/agent/sourcing-runs/:id` — body `{ phase?, stats?, error? }` → 200 `{ run }` | 401 | 404 | 400. This is the endpoint the n8n workflow calls (Task 9) as `apiPatch('/api/agent/sourcing-runs/' + runId, patch)`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/agent/sourcing-runs/[id]/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../../../db/client';
import { job_orders } from '../../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { createSourcingRun } from '../../../../../services/sourcing-runs';
import { PATCH } from './route';

function patch(id: string, body: unknown, key?: string) {
  return PATCH(
    new Request(`http://test/api/agent/sourcing-runs/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(key ? { 'x-agent-api-key': key } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function seedRun(orgId: string) {
  const [job] = await db.insert(job_orders).values({
    org_id: orgId, title: `Job ${randomUUID()}`, kind: 'contract',
  }).returning();
  const res = await createSourcingRun({ org_id: orgId, job_order_id: job.id, requested_by: null });
  if (!res.created) throw new Error('expected created');
  return res.run;
}

describe('PATCH /api/agent/sourcing-runs/:id', () => {
  it('401s without a key', async () => {
    const res = await patch(randomUUID(), { phase: 'done' });
    expect(res.status).toBe(401);
  });

  it('updates phase and stats under the agent org', async () => {
    const { orgId, key } = await seedTestAgentInFreshOrg();
    const run = await seedRun(orgId);
    const res = await patch(run.id, { phase: 'searching_pool', stats: { pool_matches: 4 } }, key);
    expect(res.status).toBe(200);
    const { run: updated } = await res.json();
    expect(updated.phase).toBe('searching_pool');
    expect(updated.stats).toMatchObject({ pool_matches: 4 });
  });

  it('404s for a run in another org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const intruder = await seedTestAgentInFreshOrg();
    const run = await seedRun(owner.orgId);
    const res = await patch(run.id, { phase: 'done' }, intruder.key);
    expect(res.status).toBe(404);
  });

  it('400s on an invalid phase', async () => {
    const { orgId, key } = await seedTestAgentInFreshOrg();
    const run = await seedRun(orgId);
    const res = await patch(run.id, { phase: 'warp_speed' }, key);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run 'src/app/api/agent/sourcing-runs/[id]/route.test.ts'`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the route**

Create `src/app/api/agent/sourcing-runs/[id]/route.ts`:

```ts
import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { updateSourcingRun } from '../../../../../services/sourcing-runs';

const PatchSchema = z.strictObject({
  phase: z.enum([
    'queued', 'searching_pool', 'checking_jobdiva', 'embedding_new',
    'shortlisting', 'screening', 'done', 'failed',
  ]).optional(),
  stats: z.record(z.string(), z.unknown()).optional(),
  error: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request, { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const patch = PatchSchema.parse(await req.json());
    const run = await updateSourcingRun(auth.org_id, id, patch);
    if (!run) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ run });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run 'src/app/api/agent/sourcing-runs/[id]/route.test.ts'`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/agent/sourcing-runs'
git commit -m "feat: agent PATCH endpoint for sourcing-run phase progress"
```

---

### Task 4: applications bulk upsert (service + agent route)

**Files:**
- Create: `src/services/applications.ts`
- Create: `src/app/api/agent/applications/route.ts`
- Test: `src/services/applications.test.ts`, `src/app/api/agent/applications/route.test.ts`

**Interfaces:**
- Consumes: `applications` table (existing; unique on `(job_order_id, candidate_id)`), `requireAgentKey`.
- Produces:
  - `upsertSourcedApplications(orgId: string, jobOrderId: string, candidateIds: string[]): Promise<{ inserted: number }>` — inserts at stage `'sourced'`, `onConflictDoNothing` (existing applications keep their stage).
  - `POST /api/agent/applications` — body `{ job_order_id, candidate_ids }` → 201 `{ inserted }`. Called by the workflow (Task 9) as `apiPost('/api/agent/applications', { job_order_id, candidate_ids })`.

- [ ] **Step 1: Write the failing service test**

Create `src/services/applications.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { applications, candidates, job_orders } from '../db/schema';
import { seedTestAgentInFreshOrg } from '../test-support/seed-agent';
import { upsertSourcedApplications } from './applications';

async function seed(orgId: string) {
  const [job] = await db.insert(job_orders).values({
    org_id: orgId, title: `Job ${randomUUID()}`, kind: 'contract',
  }).returning();
  const [c1] = await db.insert(candidates).values({ org_id: orgId, full_name: 'Ada L' }).returning();
  const [c2] = await db.insert(candidates).values({ org_id: orgId, full_name: 'Grace H' }).returning();
  return { job, c1, c2 };
}

describe('upsertSourcedApplications', () => {
  it('inserts sourced applications, skipping existing ones without touching their stage', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const { job, c1, c2 } = await seed(orgId);
    await db.insert(applications).values({
      org_id: orgId, job_order_id: job.id, candidate_id: c1.id, stage: 'interviewing',
    });

    const res = await upsertSourcedApplications(orgId, job.id, [c1.id, c2.id]);
    expect(res.inserted).toBe(1);

    const [existing] = await db.select().from(applications).where(and(
      eq(applications.job_order_id, job.id), eq(applications.candidate_id, c1.id),
    ));
    expect(existing.stage).toBe('interviewing');
    const [added] = await db.select().from(applications).where(and(
      eq(applications.job_order_id, job.id), eq(applications.candidate_id, c2.id),
    ));
    expect(added.stage).toBe('sourced');
  });

  it('handles an empty candidate list', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const { job } = await seed(orgId);
    const res = await upsertSourcedApplications(orgId, job.id, []);
    expect(res.inserted).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/applications.test.ts`
Expected: FAIL — `Cannot find module './applications'`.

- [ ] **Step 3: Write the service**

Create `src/services/applications.ts`:

```ts
import { db } from '../db/client';
import { applications } from '../db/schema';

/** Shortlist → pipeline: every shortlisted candidate becomes a 'sourced' Application.
 * Existing applications (any stage) are left untouched via the unique
 * (job_order_id, candidate_id) constraint. */
export async function upsertSourcedApplications(
  orgId: string, jobOrderId: string, candidateIds: string[],
): Promise<{ inserted: number }> {
  if (candidateIds.length === 0) return { inserted: 0 };
  const rows = await db.insert(applications)
    .values(candidateIds.map((candidate_id) => ({
      org_id: orgId, job_order_id: jobOrderId, candidate_id, stage: 'sourced',
    })))
    .onConflictDoNothing()
    .returning();
  return { inserted: rows.length };
}
```

- [ ] **Step 4: Run service test — PASS expected**

Run: `npx vitest run src/services/applications.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing route test**

Create `src/app/api/agent/applications/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../../db/client';
import { candidates, job_orders } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key?: string) {
  return POST(new Request('http://test/api/agent/applications', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-agent-api-key': key } : {}) },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/applications', () => {
  it('401s without a key', async () => {
    expect((await post({})).status).toBe(401);
  });

  it('creates sourced applications under the agent org', async () => {
    const { orgId, key } = await seedTestAgentInFreshOrg();
    const [job] = await db.insert(job_orders).values({
      org_id: orgId, title: `Job ${randomUUID()}`, kind: 'contract',
    }).returning();
    const [cand] = await db.insert(candidates).values({ org_id: orgId, full_name: 'Ada' }).returning();

    const res = await post({ job_order_id: job.id, candidate_ids: [cand.id] }, key);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: 1 });
  });

  it('400s on a malformed body', async () => {
    const { key } = await seedTestAgentInFreshOrg();
    expect((await post({ job_order_id: 'not-a-uuid', candidate_ids: [] }, key)).status).toBe(400);
  });
});
```

- [ ] **Step 6: Run to verify failure, then write the route**

Run: `npx vitest run src/app/api/agent/applications/route.test.ts` — expect module-not-found FAIL.

Create `src/app/api/agent/applications/route.ts`:

```ts
import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { upsertSourcedApplications } from '../../../../services/applications';

const BodySchema = z.strictObject({
  job_order_id: z.uuid(),
  candidate_ids: z.array(z.uuid()),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const p = BodySchema.parse(await req.json());
    const result = await upsertSourcedApplications(auth.org_id, p.job_order_id, p.candidate_ids);
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 7: Run both test files — PASS expected**

Run: `npx vitest run src/services/applications.test.ts src/app/api/agent/applications/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add src/services/applications.ts src/services/applications.test.ts src/app/api/agent/applications
git commit -m "feat: bulk-upsert sourced applications service + agent endpoint"
```

---

### Task 5: stored-embedding reader (GET /api/agent/embeddings)

Lets the workflow reuse a stored job-order embedding instead of re-calling Gemini when the job text hasn't changed.

**Files:**
- Modify: `src/services/ingest.ts` (append reader)
- Modify: `src/app/api/agent/embeddings/route.ts` (add GET)
- Test: append to `src/app/api/agent/embeddings/route.test.ts`

**Interfaces:**
- Consumes: `embeddings` table; `requireAgentKey`.
- Produces:
  - `getStoredEmbeddings(orgId: string, subjectType: 'candidate_document' | 'job_order', subjectId: string): Promise<Array<{ chunk_index: number; content_hash: string; embedding: number[] }>>`
  - `GET /api/agent/embeddings?subject_type=job_order&subject_id=<uuid>` → 200 `{ chunks: [...] }` (empty array when none). Workflow usage (Task 9): `apiGet('/api/agent/embeddings', { subject_type: 'job_order', subject_id: job_order_id })`.

- [ ] **Step 1: Write the failing test** (append to `src/app/api/agent/embeddings/route.test.ts`)

```ts
import { GET } from './route';

function get(qs: string, key?: string) {
  return GET(new Request(`http://test/api/agent/embeddings?${qs}`, {
    headers: key ? { 'x-agent-api-key': key } : {},
  }));
}

describe('GET /api/agent/embeddings', () => {
  it('401s without a key', async () => {
    expect((await get('subject_type=job_order&subject_id=x')).status).toBe(401);
  });

  it('returns stored chunks with parsed embedding vectors', async () => {
    const { orgId, key } = await seedTestAgentInFreshOrg();
    const subjectId = randomUUID();
    await post({
      org_id: orgId, subject_type: 'job_order', subject_id: subjectId,
      chunks: [{ chunk_index: 0, content: 'job text', embedding: VEC, content_hash: 'h1' }],
    }, key);

    const res = await get(`subject_type=job_order&subject_id=${subjectId}`, key);
    expect(res.status).toBe(200);
    const { chunks } = await res.json();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content_hash).toBe('h1');
    expect(chunks[0].embedding).toHaveLength(3072);
  });

  it('returns an empty list for an unknown subject', async () => {
    const { key } = await seedTestAgentInFreshOrg();
    const res = await get(`subject_type=job_order&subject_id=${randomUUID()}`, key);
    expect((await res.json()).chunks).toEqual([]);
  });
});
```

(The existing file already imports `randomUUID`, `seedTestAgentInFreshOrg`, `VEC`, and defines `post` — reuse them.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/agent/embeddings/route.test.ts`
Expected: FAIL — `GET` is not exported.

- [ ] **Step 3: Implement reader + GET handler**

Append to `src/services/ingest.ts`:

```ts
/** Read back stored embedding chunks (e.g. so a re-source can reuse the job-order
 * embedding instead of re-calling the embedding API when content is unchanged).
 * halfvec comes back from postgres as a '[1,2,...]' string — parse it. */
export async function getStoredEmbeddings(
  orgId: string,
  subjectType: 'candidate_document' | 'job_order',
  subjectId: string,
): Promise<Array<{ chunk_index: number; content_hash: string; embedding: number[] }>> {
  const rows = await db.select({
    chunk_index: embeddings.chunk_index,
    content_hash: embeddings.content_hash,
    embedding: embeddings.embedding,
  }).from(embeddings).where(and(
    eq(embeddings.org_id, orgId),
    eq(embeddings.subject_type, subjectType),
    eq(embeddings.subject_id, subjectId),
  )).orderBy(embeddings.chunk_index);
  return rows.map((r) => ({
    chunk_index: r.chunk_index,
    content_hash: r.content_hash,
    embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
  }));
}
```

(Confirm `and`, `eq`, and `embeddings` are already imported in `ingest.ts`; add any missing import.)

Append to `src/app/api/agent/embeddings/route.ts`:

```ts
import { z } from 'zod';
import { getStoredEmbeddings } from '../../../../services/ingest';

const GetQuerySchema = z.object({
  subject_type: z.enum(['candidate_document', 'job_order']),
  subject_id: z.uuid(),
});

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const parsed = GetQuerySchema.safeParse({
    subject_type: url.searchParams.get('subject_type'),
    subject_id: url.searchParams.get('subject_id'),
  });
  if (!parsed.success) {
    return Response.json({ error: 'validation_failed', issues: parsed.error.issues }, { status: 400 });
  }
  const chunks = await getStoredEmbeddings(auth.org_id, parsed.data.subject_type, parsed.data.subject_id);
  return Response.json({ chunks });
}
```

(Merge the `zod` import with the file's existing `ZodError` import.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/api/agent/embeddings/route.test.ts`
Expected: PASS (existing 2 + new 3).

- [ ] **Step 5: Commit**

```bash
git add src/services/ingest.ts src/app/api/agent/embeddings
git commit -m "feat: read back stored embeddings so re-sourcing can skip unchanged job embeds"
```

---

### Task 6: JobDiva client

**Files:**
- Create: `src/services/jobdiva.ts`
- Create: `scripts/jobdiva-smoke.ts`
- Test: `src/services/jobdiva.test.ts`

**Interfaces:**
- Produces:
  - `type JobDivaJob = { title: string; description: string | null; must_haves: string[]; nice_to_haves: string[]; kind: 'contract' | 'direct_hire' }`
  - `type JobDivaCandidate = { jobdiva_id: string; full_name: string; email: string | null; phone: string | null; current_title: string | null; location: string | null }`
  - `type JobDivaClient = { getJob(jobNumber: string): Promise<JobDivaJob | null>; searchCandidates(q: { title: string; mustHaves: string[]; location?: string }): Promise<JobDivaCandidate[]>; getResumeText(jobdivaCandidateId: string): Promise<string | null> }`
  - `makeJobDivaClient(cfg: { clientId: string; username: string; password: string; baseUrl?: string; fetchFn?: typeof fetch }): JobDivaClient`
  - `defaultJobDivaClient(): JobDivaClient` — reads `JOBDIVA_CLIENT_ID` / `JOBDIVA_USERNAME` / `JOBDIVA_PASSWORD` / `JOBDIVA_BASE_URL` (default `https://api.jobdiva.com`); throws when creds are missing.

> **Endpoint caveat:** the `ENDPOINTS` map below is the best-known JobDiva REST surface. A dedicated step verifies it against JobDiva's live API docs (their Swagger at the account's API base) and adjusts paths/mappers. The exported interface above is the contract and must not change.

- [ ] **Step 1: Write the failing tests**

Create `src/services/jobdiva.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeJobDivaClient } from './jobdiva';

function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body: unknown },
) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status = 200, body } = handler(String(input), init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  return fn as unknown as typeof fetch;
}

const CFG = { clientId: 'cid', username: 'u', password: 'p', baseUrl: 'https://jd.test' };

describe('makeJobDivaClient', () => {
  it('authenticates once and reuses the token', async () => {
    const calls: string[] = [];
    const fetchFn = fakeFetch((url) => {
      calls.push(url);
      if (url.includes('/api/authenticate')) return { body: 'tok-1' };
      return { body: [] };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    await client.searchCandidates({ title: 'Dev', mustHaves: ['React'] });
    await client.searchCandidates({ title: 'Dev', mustHaves: ['React'] });
    expect(calls.filter((u) => u.includes('/api/authenticate'))).toHaveLength(1);
  });

  it('re-authenticates once on a 401 and retries the request', async () => {
    let authCount = 0;
    let dataCalls = 0;
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) { authCount++; return { body: `tok-${authCount}` }; }
      dataCalls++;
      if (dataCalls === 1) return { status: 401, body: 'expired' };
      return { body: [{ id: '77', firstName: 'Ada', lastName: 'L' }] };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    const out = await client.searchCandidates({ title: 'Dev', mustHaves: [] });
    expect(authCount).toBe(2);
    expect(out[0]).toMatchObject({ jobdiva_id: '77', full_name: 'Ada L' });
  });

  it('maps a job and returns null for an unknown job number', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('bad-number')) return { status: 404, body: 'nope' };
      return {
        body: [{
          title: 'Platform Engineer', description: 'Build platforms',
          skills: ['Kubernetes', 'Go'], jobType: 'Contract',
        }],
      };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    const job = await client.getJob('42');
    expect(job).toMatchObject({ title: 'Platform Engineer', kind: 'contract', must_haves: ['Kubernetes', 'Go'] });
    expect(await client.getJob('bad-number')).toBeNull();
  });

  it('returns null when a candidate has no resume', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      return { body: [] };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    expect(await client.getResumeText('123')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/jobdiva.test.ts`
Expected: FAIL — `Cannot find module './jobdiva'`.

- [ ] **Step 3: Write the client**

Create `src/services/jobdiva.ts`:

```ts
// JobDiva REST client. One deep module: token auth + refresh, endpoint shapes, and
// response mapping live here; callers see only getJob / searchCandidates / getResumeText.

export type JobDivaJob = {
  title: string;
  description: string | null;
  must_haves: string[];
  nice_to_haves: string[];
  kind: 'contract' | 'direct_hire';
};

export type JobDivaCandidate = {
  jobdiva_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_title: string | null;
  location: string | null;
};

export type JobDivaClient = {
  getJob(jobNumber: string): Promise<JobDivaJob | null>;
  searchCandidates(q: { title: string; mustHaves: string[]; location?: string }): Promise<JobDivaCandidate[]>;
  getResumeText(jobdivaCandidateId: string): Promise<string | null>;
};

// Best-known JobDiva REST surface — verify against the account's live Swagger before
// first production use (see jobdiva-smoke.ts). Paths are config, the interface is not.
const ENDPOINTS = {
  auth: '/api/authenticate',
  getJob: '/apiv2/jobdiva/getJobById',
  searchCandidates: '/apiv2/jobdiva/searchCandidateProfile',
  getResume: '/apiv2/jobdiva/getCandidateResume',
};

export function makeJobDivaClient(cfg: {
  clientId: string;
  username: string;
  password: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}): JobDivaClient {
  const base = (cfg.baseUrl ?? 'https://api.jobdiva.com').replace(/\/$/, '');
  const fetchFn = cfg.fetchFn ?? fetch;
  let token: string | null = null;

  async function authenticate(): Promise<string> {
    const qs = new URLSearchParams({
      clientid: cfg.clientId, username: cfg.username, password: cfg.password,
    });
    const res = await fetchFn(`${base}${ENDPOINTS.auth}?${qs}`);
    if (!res.ok) throw new Error(`jobdiva auth failed: ${res.status}`);
    token = (await res.text()).trim().replace(/^"|"$/g, '');
    return token;
  }

  // All JobDiva calls funnel through here: attach bearer token, re-auth exactly once
  // on 401, surface everything else as an error the caller can soft-handle.
  async function request(path: string, params: Record<string, string>): Promise<Response> {
    const tk = token ?? await authenticate();
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    let res = await fetchFn(url, { headers: { authorization: `Bearer ${tk}` } });
    if (res.status === 401) {
      const fresh = await authenticate();
      res = await fetchFn(url, { headers: { authorization: `Bearer ${fresh}` } });
    }
    return res;
  }

  return {
    async getJob(jobNumber) {
      const res = await request(ENDPOINTS.getJob, { jobId: jobNumber });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`jobdiva getJob failed: ${res.status}`);
      const data = await res.json() as Array<Record<string, unknown>>;
      const j = Array.isArray(data) ? data[0] : data;
      if (!j) return null;
      const skills = Array.isArray(j.skills) ? (j.skills as string[]) : [];
      return {
        title: String(j.title ?? `JobDiva job ${jobNumber}`),
        description: j.description != null ? String(j.description) : null,
        must_haves: skills,
        nice_to_haves: [],
        kind: String(j.jobType ?? '').toLowerCase().includes('direct') ? 'direct_hire' : 'contract',
      };
    },

    async searchCandidates(q) {
      const keywords = [q.title, ...q.mustHaves].filter(Boolean).join(' ');
      const params: Record<string, string> = { keywords, maxreturned: '50' };
      if (q.location) params.location = q.location;
      const res = await request(ENDPOINTS.searchCandidates, params);
      if (!res.ok) throw new Error(`jobdiva searchCandidates failed: ${res.status}`);
      const data = await res.json() as Array<Record<string, unknown>>;
      return (Array.isArray(data) ? data : []).map((c) => ({
        jobdiva_id: String(c.id),
        full_name: [c.firstName, c.lastName].filter(Boolean).join(' ') || String(c.id),
        email: c.email != null ? String(c.email) : null,
        phone: c.phone != null ? String(c.phone) : null,
        current_title: c.currentTitle != null ? String(c.currentTitle) : null,
        location: c.city != null ? String(c.city) : null,
      }));
    },

    async getResumeText(jobdivaCandidateId) {
      const res = await request(ENDPOINTS.getResume, { candidateid: jobdivaCandidateId });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`jobdiva getResume failed: ${res.status}`);
      const data = await res.json() as Array<{ resumeText?: string }> | { resumeText?: string };
      const first = Array.isArray(data) ? data[0] : data;
      const text = first?.resumeText?.trim();
      return text ? text : null;
    },
  };
}

export function defaultJobDivaClient(): JobDivaClient {
  const clientId = process.env.JOBDIVA_CLIENT_ID;
  const username = process.env.JOBDIVA_USERNAME;
  const password = process.env.JOBDIVA_PASSWORD;
  if (!clientId || !username || !password) {
    throw new Error('jobdiva: set JOBDIVA_CLIENT_ID, JOBDIVA_USERNAME, JOBDIVA_PASSWORD');
  }
  return makeJobDivaClient({
    clientId, username, password, baseUrl: process.env.JOBDIVA_BASE_URL,
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/jobdiva.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the smoke script** (manual, not CI)

Create `scripts/jobdiva-smoke.ts`:

```ts
// One-off manual check of the JobDiva client against the real API. Not run in CI.
// Usage: npx tsx scripts/jobdiva-smoke.ts <job-number>
import 'dotenv/config';
import { defaultJobDivaClient } from '../src/services/jobdiva';

async function main() {
  const jobNumber = process.argv[2];
  if (!jobNumber) throw new Error('usage: npx tsx scripts/jobdiva-smoke.ts <job-number>');
  const client = defaultJobDivaClient();

  const job = await client.getJob(jobNumber);
  console.log('getJob:', JSON.stringify(job, null, 2));
  if (!job) return;

  const candidates = await client.searchCandidates({ title: job.title, mustHaves: job.must_haves });
  console.log(`searchCandidates: ${candidates.length} hits`);
  console.log(JSON.stringify(candidates.slice(0, 3), null, 2));

  if (candidates[0]) {
    const resume = await client.getResumeText(candidates[0].jobdiva_id);
    console.log('getResumeText length:', resume?.length ?? null);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 6: Verify endpoints against JobDiva's live docs**

With real credentials in `.env.local`, open the account's JobDiva Swagger/API docs and compare against `ENDPOINTS` and the three response mappers. Run `npx tsx scripts/jobdiva-smoke.ts <a-real-job-number>` and fix `ENDPOINTS` + mappers until all three calls print sensible data. **Do not change the exported interface.** If no credentials are available yet, record that this step is deferred in the commit message and move on — unit tests still pin the contract.

- [ ] **Step 7: Add `JOBDIVA_BASE_URL` to `.env.example`**

Append to `.env.example`:

```
JOBDIVA_BASE_URL=https://api.jobdiva.com
```

- [ ] **Step 8: Commit**

```bash
git add src/services/jobdiva.ts src/services/jobdiva.test.ts scripts/jobdiva-smoke.ts .env.example
git commit -m "feat: JobDiva client (auth, job fetch, candidate search, resume fetch)"
```

---

### Task 7: targeted JobDiva import (service + agent route)

**Files:**
- Create: `src/services/jobdiva-import.ts`
- Create: `src/app/api/agent/jobdiva/import-candidates/route.ts`
- Test: `src/services/jobdiva-import.test.ts`, `src/app/api/agent/jobdiva/import-candidates/route.test.ts`

**Interfaces:**
- Consumes: `JobDivaClient` (Task 6), `ingestCandidate` + `upsertEmbeddings` (existing, `src/services/ingest.ts`), `EmbedFn` (existing, `src/services/embed.ts`), `updateSourcingRun` (Task 2), `getJobOrder` (existing, `src/services/matching.ts`).
- Produces:
  - `importCandidatesForJob(input: { org_id: string; job_order_id: string; sourcing_run_id?: string | null }, deps: { jobdiva: JobDivaClient; embed: EmbedFn }): Promise<{ jobdiva_found: number; jobdiva_new: number; embedded: number; skipped: number }>`
  - `RESUME_FETCH_CAP = 25`
  - `POST /api/agent/jobdiva/import-candidates` — body `{ job_order_id, sourcing_run_id? }` → 200 counts | 502 `{ error: 'jobdiva_unavailable', message }`. Workflow usage (Task 9): `apiPost('/api/agent/jobdiva/import-candidates', { job_order_id, sourcing_run_id })`.

- [ ] **Step 1: Write the failing service tests**

Create `src/services/jobdiva-import.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates, candidate_documents, embeddings, job_orders } from '../db/schema';
import { seedTestAgentInFreshOrg } from '../test-support/seed-agent';
import { importCandidatesForJob } from './jobdiva-import';
import type { JobDivaClient, JobDivaCandidate } from './jobdiva';

const VEC = new Array(3072).fill(0.1);
const fakeEmbed = async () => VEC;

function fakeJobDiva(hits: JobDivaCandidate[], resumes: Record<string, string | null>): JobDivaClient {
  return {
    getJob: async () => null,
    searchCandidates: async () => hits,
    getResumeText: async (id) => resumes[id] ?? null,
  };
}

async function seedJob(orgId: string): Promise<string> {
  const [row] = await db.insert(job_orders).values({
    org_id: orgId, title: 'Rust Engineer', kind: 'contract',
    must_haves: ['Rust', 'gRPC'],
  }).returning();
  return row.id;
}

const hit = (id: string, name: string): JobDivaCandidate => ({
  jobdiva_id: id, full_name: name, email: `${id}@x.test`, phone: null,
  current_title: 'Engineer', location: null,
});

describe('importCandidatesForJob', () => {
  it('ingests and embeds new candidates with resumes', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const jd = fakeJobDiva(
      [hit('jd-1', 'Ada L'), hit('jd-2', 'Grace H')],
      { 'jd-1': 'Ada resume: Rust, gRPC.', 'jd-2': null },
    );

    const out = await importCandidatesForJob(
      { org_id: orgId, job_order_id: jobId }, { jobdiva: jd, embed: fakeEmbed },
    );
    expect(out).toMatchObject({ jobdiva_found: 2, jobdiva_new: 2, embedded: 1 });

    const rows = await db.select().from(candidates).where(eq(candidates.org_id, orgId));
    expect(rows.map((r) => r.jobdiva_id).sort()).toEqual(['jd-1', 'jd-2']);
    const embRows = await db.select().from(embeddings).where(and(
      eq(embeddings.org_id, orgId), eq(embeddings.subject_type, 'candidate_document'),
    ));
    expect(embRows.length).toBeGreaterThanOrEqual(1);
  });

  it('skips resume fetch + embedding for known candidates that already have a document', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const [known] = await db.insert(candidates).values({
      org_id: orgId, full_name: 'Ada L', jobdiva_id: 'jd-1',
    }).returning();
    await db.insert(candidate_documents).values({
      org_id: orgId, candidate_id: known.id, storage_key: 'k', parsed_text: 'existing resume',
    });

    let resumeFetches = 0;
    const jd: JobDivaClient = {
      getJob: async () => null,
      searchCandidates: async () => [hit('jd-1', 'Ada L')],
      getResumeText: async () => { resumeFetches++; return 'new resume'; },
    };

    const out = await importCandidatesForJob(
      { org_id: orgId, job_order_id: jobId }, { jobdiva: jd, embed: fakeEmbed },
    );
    expect(resumeFetches).toBe(0);
    expect(out).toMatchObject({ jobdiva_found: 1, jobdiva_new: 0, embedded: 0 });
  });

  it('a bad candidate skips, the batch continues', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const bad: JobDivaCandidate = { ...hit('jd-9', ''), full_name: '' }; // fails ingest validation
    const jd = fakeJobDiva([bad, hit('jd-10', 'Grace H')], { 'jd-10': 'Grace resume' });

    const out = await importCandidatesForJob(
      { org_id: orgId, job_order_id: jobId }, { jobdiva: jd, embed: fakeEmbed },
    );
    expect(out.skipped).toBe(1);
    expect(out.jobdiva_new).toBe(1);
  });

  it('throws when the job order does not exist in the org', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    await expect(importCandidatesForJob(
      { org_id: orgId, job_order_id: randomUUID() },
      { jobdiva: fakeJobDiva([], {}), embed: fakeEmbed },
    )).rejects.toThrow(/job order/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/jobdiva-import.test.ts`
Expected: FAIL — `Cannot find module './jobdiva-import'`.

- [ ] **Step 3: Write the service**

Create `src/services/jobdiva-import.ts`:

```ts
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates, candidate_documents } from '../db/schema';
import { ingestCandidate, upsertEmbeddings } from './ingest';
import { updateSourcingRun } from './sourcing-runs';
import { getJobOrder } from './matching';
import type { EmbedFn } from './embed';
import type { JobDivaClient } from './jobdiva';

/** Hard cap on JobDiva resume fetches per run — one thin job must not trigger
 * hundreds of resume pulls. */
export const RESUME_FETCH_CAP = 25;

// Mirrors the n8n helpers' chunker so app-side and workflow-side embeddings agree.
function chunkText(text: string, size = 1500, overlap = 200): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function importCandidatesForJob(
  input: { org_id: string; job_order_id: string; sourcing_run_id?: string | null },
  deps: { jobdiva: JobDivaClient; embed: EmbedFn },
): Promise<{ jobdiva_found: number; jobdiva_new: number; embedded: number; skipped: number }> {
  const job = await getJobOrder(input.org_id, input.job_order_id);
  if (!job) throw new Error(`job order not found: ${input.job_order_id}`);

  const runId = input.sourcing_run_id ?? null;
  const hits = await deps.jobdiva.searchCandidates({
    title: job.title,
    mustHaves: (job.must_haves as string[] | null) ?? [],
  });
  if (runId) {
    await updateSourcingRun(input.org_id, runId, {
      phase: 'embedding_new', stats: { jobdiva_found: hits.length },
    });
  }

  // Resume fetches are the expensive JobDiva call: only candidates that are unknown,
  // or known but resume-less, get one (capped).
  const knownRows = hits.length === 0 ? [] : await db.select({
    id: candidates.id, jobdiva_id: candidates.jobdiva_id,
  }).from(candidates).where(and(
    eq(candidates.org_id, input.org_id),
    inArray(candidates.jobdiva_id, hits.map((h) => h.jobdiva_id)),
  ));
  const knownIds = knownRows.map((r) => r.id);
  const docRows = knownIds.length === 0 ? [] : await db.select({
    candidate_id: candidate_documents.candidate_id,
  }).from(candidate_documents).where(and(
    eq(candidate_documents.org_id, input.org_id),
    inArray(candidate_documents.candidate_id, knownIds),
  ));
  const knownByJd = new Map(knownRows.map((r) => [r.jobdiva_id, r.id]));
  const hasDoc = new Set(docRows.map((r) => r.candidate_id));

  let jobdiva_new = 0, embedded = 0, skipped = 0, resumeFetches = 0;
  for (const hit of hits) {
    try {
      const knownId = knownByJd.get(hit.jobdiva_id);
      const needsResume = !knownId || !hasDoc.has(knownId);
      let resumeText: string | null = null;
      if (needsResume && resumeFetches < RESUME_FETCH_CAP) {
        resumeFetches++;
        resumeText = await deps.jobdiva.getResumeText(hit.jobdiva_id);
      }

      const res = await ingestCandidate({
        org_id: input.org_id, full_name: hit.full_name, email: hit.email,
        phone: hit.phone, current_title: hit.current_title, location: hit.location,
        source: 'jobdiva', jobdiva_id: hit.jobdiva_id, resume_text: resumeText,
      });
      if (!res.deduped) jobdiva_new++;

      if (res.document_id && resumeText) {
        const chunks = chunkText(resumeText);
        const vectors = await Promise.all(chunks.map((c) => deps.embed(c)));
        await upsertEmbeddings({
          org_id: input.org_id, subject_type: 'candidate_document', subject_id: res.document_id,
          chunks: chunks.map((content, i) => ({
            chunk_index: i, content, embedding: vectors[i], content_hash: sha256(content),
          })),
        });
        embedded++;
      }
    } catch {
      // One bad candidate must not sink the batch — same isolation philosophy as
      // screening's per-candidate try/catch.
      skipped++;
    }
  }

  const out = { jobdiva_found: hits.length, jobdiva_new, embedded, skipped };
  if (runId) await updateSourcingRun(input.org_id, runId, { stats: out });
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/jobdiva-import.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing route test**

Create `src/app/api/agent/jobdiva/import-candidates/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key?: string) {
  return POST(new Request('http://test/api/agent/jobdiva/import-candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-agent-api-key': key } : {}) },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/jobdiva/import-candidates', () => {
  it('401s without a key', async () => {
    expect((await post({})).status).toBe(401);
  });

  it('400s on a malformed body', async () => {
    const { key } = await seedTestAgentInFreshOrg();
    expect((await post({ job_order_id: 'nope' }, key)).status).toBe(400);
  });

  it('502s as jobdiva_unavailable when JobDiva creds are missing/unreachable', async () => {
    const { key } = await seedTestAgentInFreshOrg();
    // No JOBDIVA_* env in test → defaultJobDivaClient() throws → route maps to 502.
    const res = await post({ job_order_id: randomUUID() }, key);
    expect([502, 404]).toContain(res.status); // 404 only if creds ARE set and job is missing
  });
});
```

- [ ] **Step 6: Run to verify failure, then write the route**

Run: `npx vitest run src/app/api/agent/jobdiva/import-candidates/route.test.ts` — expect module-not-found FAIL.

Create `src/app/api/agent/jobdiva/import-candidates/route.ts`:

```ts
import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { importCandidatesForJob } from '../../../../../services/jobdiva-import';
import { defaultJobDivaClient } from '../../../../../services/jobdiva';
import { defaultEmbedder } from '../../../../../services/embed';

const BodySchema = z.strictObject({
  job_order_id: z.uuid(),
  sourcing_run_id: z.uuid().nullable().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const p = BodySchema.parse(await req.json());
    let jobdiva, embed;
    try {
      jobdiva = defaultJobDivaClient();
      embed = defaultEmbedder();
    } catch (err) {
      return Response.json(
        { error: 'jobdiva_unavailable', message: String((err as Error).message) },
        { status: 502 },
      );
    }
    const out = await importCandidatesForJob(
      { org_id: auth.org_id, job_order_id: p.job_order_id, sourcing_run_id: p.sourcing_run_id },
      { jobdiva, embed },
    );
    return Response.json(out);
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    if (err instanceof Error && /job order not found/.test(err.message)) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (err instanceof Error && /jobdiva/i.test(err.message)) {
      return Response.json({ error: 'jobdiva_unavailable', message: err.message }, { status: 502 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run src/app/api/agent/jobdiva/import-candidates/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/services/jobdiva-import.ts src/services/jobdiva-import.test.ts src/app/api/agent/jobdiva
git commit -m "feat: targeted JobDiva candidate import with dedupe and new-resume-only embedding"
```

---

### Task 8: session routes — job import + source start/status

**Files:**
- Create: `src/lib/n8n.ts`
- Create: `src/app/api/jobs/import/route.ts`
- Create: `src/app/api/jobs/[id]/source/route.ts`
- Modify: `src/services/sourcing-runs.ts` (add `getSourcingShortlist`)
- Test: `src/app/api/jobs/import/route.test.ts`, `src/app/api/jobs/[id]/source/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `auth` (`src/lib/auth.ts` — session routes call `await auth()`; tests mock it via `vi.mock`), `createSourcingRun`/`updateSourcingRun`/`getLatestSourcingRun` (Task 2), `defaultJobDivaClient` (Task 6), `decisions` + `scores` tables.
- Produces:
  - `fireSourcingWebhook(body: { org_id: string; job_order_id: string; sourcing_run_id: string }, fetchFn?: typeof fetch): Promise<{ ok: boolean; error?: string }>` — POSTs `${N8N_WEBHOOK_URL}/source`.
  - `getSourcingShortlist(orgId: string, jobOrderId: string): Promise<Array<{ candidate_id: string; full_name: string; current_title: string | null; distance: number; fit_rating: string | null }> | null>` — from the latest executed `source.shortlist` decision's `payload.ranked`, joined to latest `scores.fit_rating` per candidate; `null` when no executed shortlist exists.
  - `POST /api/jobs/import` — body `{ jobdiva_job_number }` → 200 `{ job_order_id, created }` | 404 | 502 | 401.
  - `POST /api/jobs/[id]/source` → 201 `{ sourcing_run_id }` | 409 `{ error: 'run_active' }` | 401 | 404.
  - `GET /api/jobs/[id]/source` → 200 `{ run, shortlist }` (both nullable) | 401.

- [ ] **Step 1: Add `getSourcingShortlist` to `src/services/sourcing-runs.ts`**

Append (add `decisions`, `scores` to the schema import, plus `inArray`):

```ts
import { inArray } from 'drizzle-orm';
import { decisions, scores } from '../db/schema';

export type ShortlistEntry = {
  candidate_id: string;
  full_name: string;
  current_title: string | null;
  distance: number;
  fit_rating: string | null;
};

/** The recruiter-facing shortlist: the latest executed source.shortlist decision's
 * ranked payload, decorated with the latest screening fit per candidate. */
export async function getSourcingShortlist(
  orgId: string, jobOrderId: string,
): Promise<ShortlistEntry[] | null> {
  const [d] = await db.select().from(decisions).where(and(
    eq(decisions.org_id, orgId),
    eq(decisions.job_order_id, jobOrderId),
    eq(decisions.action_class, 'source.shortlist'),
    eq(decisions.state, 'executed'),
  )).orderBy(desc(decisions.proposed_at)).limit(1);
  if (!d) return null;

  const ranked = (d.payload as { ranked?: Array<{
    candidate_id: string; full_name: string; current_title: string | null; distance: number;
  }> }).ranked ?? [];
  if (ranked.length === 0) return [];

  const scoreRows = await db.select({
    candidate_id: scores.candidate_id, fit_rating: scores.fit_rating, created_at: scores.created_at,
  }).from(scores).where(and(
    eq(scores.org_id, orgId), eq(scores.job_order_id, jobOrderId),
    inArray(scores.candidate_id, ranked.map((r) => r.candidate_id)),
  ));
  const latestFit = new Map<string, { at: Date; fit: string }>();
  for (const s of scoreRows) {
    const prev = latestFit.get(s.candidate_id);
    if (!prev || s.created_at > prev.at) latestFit.set(s.candidate_id, { at: s.created_at, fit: s.fit_rating });
  }
  return ranked.map((r) => ({
    ...r, fit_rating: latestFit.get(r.candidate_id)?.fit ?? null,
  }));
}
```

(Merge the `inArray` import into the existing `drizzle-orm` import line.)

- [ ] **Step 2: Write `src/lib/n8n.ts`**

```ts
import { getEnv } from './env';

/** Fire-and-check the n8n sourcing webhook. Never throws — callers decide what a
 * failure means (the source route marks the run failed immediately). */
export async function fireSourcingWebhook(
  body: { org_id: string; job_order_id: string; sourcing_run_id: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchFn(`${getEnv('N8N_WEBHOOK_URL')}/source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `n8n webhook returned ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  }
}
```

(Check `src/lib/env.ts` — if `getEnv` throws on missing vars, that's the desired behavior surfaced as `{ ok: false }` via the catch.)

- [ ] **Step 3: Write the failing route tests**

Session routes need a mocked session. Create `src/app/api/jobs/[id]/source/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../../../db/client';
import { job_orders, orgs, sourcing_runs } from '../../../../../db/schema';
import { eq } from 'drizzle-orm';

const mockSession = vi.hoisted(() => ({ current: null as null | { user: { id: string; org_id: string } } }));
vi.mock('../../../../../lib/auth', () => ({
  auth: async () => mockSession.current,
}));
const mockWebhook = vi.hoisted(() => ({ result: { ok: true } as { ok: boolean; error?: string } }));
vi.mock('../../../../../lib/n8n', () => ({
  fireSourcingWebhook: async () => mockWebhook.result,
}));

import { POST, GET } from './route';

async function seedOrgJob() {
  const [org] = await db.insert(orgs).values({ name: `org-${randomUUID()}` }).returning();
  const [job] = await db.insert(job_orders).values({
    org_id: org.id, title: 'T', kind: 'contract',
  }).returning();
  mockSession.current = { user: { id: randomUUID(), org_id: org.id } };
  return { org, job };
}

function call(method: 'POST' | 'GET', id: string) {
  const req = new Request(`http://test/api/jobs/${id}/source`, { method });
  const ctx = { params: Promise.resolve({ id }) };
  return method === 'POST' ? POST(req, ctx) : GET(req, ctx);
}

beforeEach(() => { mockSession.current = null; mockWebhook.result = { ok: true }; });

describe('POST /api/jobs/[id]/source', () => {
  it('401s without a session', async () => {
    expect((await call('POST', randomUUID())).status).toBe(401);
  });

  it('creates a run and fires the webhook', async () => {
    const { job } = await seedOrgJob();
    const res = await call('POST', job.id);
    expect(res.status).toBe(201);
    const { sourcing_run_id } = await res.json();
    const [run] = await db.select().from(sourcing_runs).where(eq(sourcing_runs.id, sourcing_run_id));
    expect(run.job_order_id).toBe(job.id);
  });

  it('409s while a run is active', async () => {
    const { job } = await seedOrgJob();
    expect((await call('POST', job.id)).status).toBe(201);
    expect((await call('POST', job.id)).status).toBe(409);
  });

  it('marks the run failed when the webhook cannot be reached', async () => {
    const { job } = await seedOrgJob();
    mockWebhook.result = { ok: false, error: 'connect ECONNREFUSED' };
    const res = await call('POST', job.id);
    expect(res.status).toBe(201);
    const { sourcing_run_id } = await res.json();
    const [run] = await db.select().from(sourcing_runs).where(eq(sourcing_runs.id, sourcing_run_id));
    expect(run.phase).toBe('failed');
    expect(run.error).toMatch(/agent runtime/i);
  });

  it('404s for a job in another org', async () => {
    const { job } = await seedOrgJob();
    const [otherOrg] = await db.insert(orgs).values({ name: `org-${randomUUID()}` }).returning();
    mockSession.current = { user: { id: randomUUID(), org_id: otherOrg.id } };
    expect((await call('POST', job.id)).status).toBe(404);
  });
});

describe('GET /api/jobs/[id]/source', () => {
  it('returns null run and shortlist before any sourcing', async () => {
    const { job } = await seedOrgJob();
    const res = await call('GET', job.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run: null, shortlist: null });
  });

  it('returns the active run after POST', async () => {
    const { job } = await seedOrgJob();
    await call('POST', job.id);
    const { run } = await (await call('GET', job.id)).json();
    expect(run.phase).toBe('queued');
  });
});
```

Create `src/app/api/jobs/import/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../../db/client';
import { job_orders, orgs } from '../../../../db/schema';
import { eq, and } from 'drizzle-orm';
import type { JobDivaJob } from '../../../../services/jobdiva';

const mockSession = vi.hoisted(() => ({ current: null as null | { user: { id: string; org_id: string } } }));
vi.mock('../../../../lib/auth', () => ({ auth: async () => mockSession.current }));

const mockJd = vi.hoisted(() => ({
  job: null as JobDivaJob | null,
  fail: false,
}));
vi.mock('../../../../services/jobdiva', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/jobdiva')>()),
  defaultJobDivaClient: () => ({
    getJob: async () => { if (mockJd.fail) throw new Error('jobdiva down'); return mockJd.job; },
    searchCandidates: async () => [],
    getResumeText: async () => null,
  }),
}));

import { POST } from './route';

function post(body: unknown) {
  return POST(new Request('http://test/api/jobs/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => { mockSession.current = null; mockJd.job = null; mockJd.fail = false; });

async function seedOrg() {
  const [org] = await db.insert(orgs).values({ name: `org-${randomUUID()}` }).returning();
  mockSession.current = { user: { id: randomUUID(), org_id: org.id } };
  return org;
}

describe('POST /api/jobs/import', () => {
  it('401s without a session', async () => {
    expect((await post({ jobdiva_job_number: '42' })).status).toBe(401);
  });

  it('returns the existing job order when the number is already imported', async () => {
    const org = await seedOrg();
    const [existing] = await db.insert(job_orders).values({
      org_id: org.id, title: 'Already here', kind: 'contract', jobdiva_id: 'JD-42',
    }).returning();
    const res = await post({ jobdiva_job_number: 'JD-42' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_order_id: existing.id, created: false });
  });

  it('imports an unknown job from JobDiva', async () => {
    const org = await seedOrg();
    mockJd.job = {
      title: 'Platform Engineer', description: 'Build platforms',
      must_haves: ['Kubernetes'], nice_to_haves: [], kind: 'contract',
    };
    const res = await post({ jobdiva_job_number: 'JD-77' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    const [row] = await db.select().from(job_orders).where(and(
      eq(job_orders.org_id, org.id), eq(job_orders.jobdiva_id, 'JD-77'),
    ));
    expect(row.title).toBe('Platform Engineer');
  });

  it('404s when JobDiva does not know the number', async () => {
    await seedOrg();
    expect((await post({ jobdiva_job_number: 'JD-00' })).status).toBe(404);
  });

  it('502s when JobDiva is unreachable', async () => {
    await seedOrg();
    mockJd.fail = true;
    expect((await post({ jobdiva_job_number: 'JD-77' })).status).toBe(502);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/app/api/jobs`
Expected: FAIL — `Cannot find module './route'` (both files).

- [ ] **Step 5: Write the routes**

Create `src/app/api/jobs/import/route.ts`:

```ts
import { z, ZodError } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '../../../../lib/auth';
import { db } from '../../../../db/client';
import { job_orders } from '../../../../db/schema';
import { defaultJobDivaClient } from '../../../../services/jobdiva';

const BodySchema = z.strictObject({ jobdiva_job_number: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;
  try {
    const { jobdiva_job_number } = BodySchema.parse(await req.json());

    const [existing] = await db.select().from(job_orders).where(and(
      eq(job_orders.org_id, orgId), eq(job_orders.jobdiva_id, jobdiva_job_number),
    ));
    if (existing) return Response.json({ job_order_id: existing.id, created: false });

    let job;
    try {
      job = await defaultJobDivaClient().getJob(jobdiva_job_number);
    } catch (err) {
      return Response.json(
        { error: 'jobdiva_unavailable', message: String((err as Error).message) },
        { status: 502 },
      );
    }
    if (!job) return Response.json({ error: 'job_not_found_in_jobdiva' }, { status: 404 });

    const [row] = await db.insert(job_orders).values({
      org_id: orgId, title: job.title, description: job.description,
      must_haves: job.must_haves, nice_to_haves: job.nice_to_haves,
      kind: job.kind, jobdiva_id: jobdiva_job_number,
    }).returning();
    return Response.json({ job_order_id: row.id, created: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

Create `src/app/api/jobs/[id]/source/route.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { auth } from '../../../../../lib/auth';
import { db } from '../../../../../db/client';
import { job_orders } from '../../../../../db/schema';
import { fireSourcingWebhook } from '../../../../../lib/n8n';
import {
  createSourcingRun, getLatestSourcingRun, getSourcingShortlist, updateSourcingRun,
} from '../../../../../services/sourcing-runs';

async function requireJob(orgId: string, id: string) {
  const [job] = await db.select().from(job_orders).where(and(
    eq(job_orders.org_id, orgId), eq(job_orders.id, id),
  ));
  return job ?? null;
}

export async function POST(
  _req: Request, { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;
  const { id } = await params;

  const job = await requireJob(orgId, id);
  if (!job) return Response.json({ error: 'not_found' }, { status: 404 });

  const res = await createSourcingRun({
    org_id: orgId, job_order_id: id, requested_by: session.user.id ?? null,
  });
  if (!res.created) {
    return Response.json({ error: 'run_active', sourcing_run_id: res.active.id }, { status: 409 });
  }

  const fired = await fireSourcingWebhook({
    org_id: orgId, job_order_id: id, sourcing_run_id: res.run.id,
  });
  if (!fired.ok) {
    // Fail fast and visibly — the recruiter sees it in the panel, nothing hangs in 'queued'.
    await updateSourcingRun(orgId, res.run.id, {
      phase: 'failed',
      error: `Couldn't reach the agent runtime: ${fired.error ?? 'unknown error'}`,
    });
  }
  return Response.json({ sourcing_run_id: res.run.id }, { status: 201 });
}

export async function GET(
  _req: Request, { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;
  const { id } = await params;

  const [run, shortlist] = await Promise.all([
    getLatestSourcingRun(orgId, id),
    getSourcingShortlist(orgId, id),
  ]);
  return Response.json({ run, shortlist });
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/app/api/jobs src/services/sourcing-runs.test.ts`
Expected: PASS (12 route tests + 5 service tests).

- [ ] **Step 7: Add `N8N_WEBHOOK_URL` to `.env.example`**

Append:

```
N8N_WEBHOOK_URL=http://localhost:5678/webhook
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/n8n.ts src/app/api/jobs src/services/sourcing-runs.ts .env.example
git commit -m "feat: session routes to import a JobDiva job and start/poll a sourcing run"
```

---

### Task 9: n8n workflow — phases, hash-skip, thin check, applications

**Files:**
- Modify: `n8n/workflows/src/helpers.js`
- Modify: `n8n/workflows/src/sourcing.workflow.mjs`
- Modify: `n8n/tests/sourcing-screening.sh`

**Interfaces:**
- Consumes: `PATCH /api/agent/sourcing-runs/:id` (Task 3), `POST /api/agent/applications` (Task 4), `GET /api/agent/embeddings` (Task 5), `POST /api/agent/jobdiva/import-candidates` (Task 7), plus all endpoints the workflow already uses.
- Produces: the extended `agencyos-sourcing` workflow. Webhook body: `{ org_id, job_order_id, sourcing_run_id? }`.

- [ ] **Step 1: Extend `helpers.js`**

Add after the `apiPost` line:

```js
const apiPatch = (path, body) => http({ method: 'PATCH', url: API + path, headers: HEADERS, body, json: true });
// Sourcing tuning knobs. MAX_DISTANCE is cosine distance (lower = closer); a run with
// fewer than MIN_GOOD_MATCHES results under it is "thin" and triggers the JobDiva pull.
const MIN_GOOD_MATCHES = 10;
const MAX_DISTANCE = 0.55;
// Advance a sourcing_runs row; no-op without a run id (orchestrator-triggered runs),
// and never let a progress-report failure kill the run itself.
const updateRun = async (runId, patch) => {
  if (!runId) return;
  try { await apiPatch('/api/agent/sourcing-runs/' + runId, patch); } catch (e) { /* non-fatal */ }
};
```

- [ ] **Step 2: Rewrite the sourcing Code node**

Replace the `source` node body in `n8n/workflows/src/sourcing.workflow.mjs` with:

```js
import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Source In', 'source');

const source = code('Build Shortlist', 'sourcing', `
const b = $json.body ?? $json;
const { org_id, job_order_id, sourcing_run_id = null } = b;
if (!org_id || !job_order_id) throw new Error('source requires org_id and job_order_id');

try {
  await updateRun(sourcing_run_id, { phase: 'searching_pool' });

  const { job_order: job } = await apiGet('/api/agent/job-orders/' + job_order_id, { org_id });
  const jobText = [
    job.title,
    job.description ?? '',
    'Must have: ' + JSON.stringify(job.must_haves ?? []),
    'Nice to have: ' + JSON.stringify(job.nice_to_haves ?? []),
  ].join('\\n');

  // Reuse the stored job embedding when the text is unchanged; embed + store otherwise.
  const jobHash = sha256(jobText);
  const { chunks: stored } = await apiGet('/api/agent/embeddings',
    { subject_type: 'job_order', subject_id: job_order_id });
  let queryEmbedding;
  if (stored.length > 0 && stored[0].content_hash === jobHash) {
    queryEmbedding = stored[0].embedding;
  } else {
    queryEmbedding = await embed(jobText);
    await apiPost('/api/agent/embeddings', {
      org_id, subject_type: 'job_order', subject_id: job_order_id,
      chunks: [{ chunk_index: 0, content: jobText, embedding: queryEmbedding, content_hash: jobHash }],
    });
    await apiPost('/api/agent/runs', {
      org_id, agent: 'sourcing', workflow: 'agencyos-sourcing',
      model: 'gemini-embedding-001', prompt_version: null,
      tokens_in: null, tokens_out: null, status: 'succeeded', decision_id: null,
    });
  }

  const search = () => apiPost('/api/agent/search/candidates', {
    org_id, query_embedding: queryEmbedding, limit: 10,
  });
  let { results } = await search();
  await updateRun(sourcing_run_id, { stats: { pool_matches: results.length } });

  // Thin check: only reach for JobDiva when the internal pool can't cover the job.
  const good = results.filter((r) => Number(r.distance) < MAX_DISTANCE);
  let jobdivaUsed = false;
  if (good.length < MIN_GOOD_MATCHES) {
    await updateRun(sourcing_run_id, { phase: 'checking_jobdiva' });
    try {
      await apiPost('/api/agent/jobdiva/import-candidates', { job_order_id, sourcing_run_id });
      jobdivaUsed = true;
      ({ results } = await search());
    } catch (e) {
      // Soft failure: a thin shortlist beats no shortlist. Recorded for the panel.
      await updateRun(sourcing_run_id, {
        stats: { jobdiva_error: String((e && e.message) || e).slice(0, 300) },
      });
    }
  }

  await updateRun(sourcing_run_id, { phase: 'shortlisting', stats: { shortlisted: results.length } });

  const d = await proposeDecision({
    org_id, agent: 'sourcing', action_class: 'source.shortlist',
    reasoning: {
      summary: 'Shortlisted ' + results.length + ' candidates for "' + job.title + '" by vector similarity'
        + (jobdivaUsed ? ' (pool was thin — pulled fresh candidates from JobDiva)' : ' over the internal pool'),
      evidence: results.map((r) => r.full_name + ': distance ' + Number(r.distance).toFixed(4)),
      model: 'gemini-embedding-001', prompt_version: 'sourcing-v1',
    },
    payload: { candidate_ids: results.map((r) => r.candidate_id), ranked: results },
    job_order_id,
  });
  await completeDecision(d.decision.id, { shortlisted: results.length });

  if (results.length > 0) {
    await apiPost('/api/agent/applications', {
      job_order_id, candidate_ids: results.map((r) => r.candidate_id),
    });
    await updateRun(sourcing_run_id, { phase: 'screening' });
    await http({ method: 'POST', url: 'http://localhost:5678/webhook/screen',
      body: { org_id, job_order_id, candidate_ids: results.map((r) => r.candidate_id) }, json: true });
  }

  await updateRun(sourcing_run_id, { phase: 'done' });
  return [{ json: { shortlisted: results.length } }];
} catch (err) {
  await updateRun(sourcing_run_id, {
    phase: 'failed', error: String((err && err.message) || err).slice(0, 500),
  });
  throw err;
}
`);

export default workflow('agencyos-sourcing', 'AgencyOS Sourcing', [trigger, source]);
```

Note: `phase: 'done'` lands after the screening handoff fires; the panel's "screening" phase is brief by design — fit badges keep arriving after `done` via the shortlist's `fit_rating` join.

- [ ] **Step 3: Rebuild and apply the workflows**

Run: `node n8n/build.mjs && ./n8n/apply.sh` (with `docker compose up -d` running and the dev server on :3000 — check `n8n/apply.sh` for its exact expectations).
Expected: sourcing workflow republished without errors.

- [ ] **Step 4: Extend the shell test**

In `n8n/tests/sourcing-screening.sh`, after the existing `wait_for` blocks, append:

```bash
# --- UI-triggered run: phase progression + JobDiva soft-fail ---------------------
# Create a run row like POST /api/jobs/:id/source does, then hit the webhook with it.
RUN_ID=$($PSQL "insert into sourcing_runs (org_id, job_order_id) values ('$ORG_ID', '$JOB_ID') returning id")
echo "sourcing run: $RUN_ID"

curl -s -X POST http://localhost:5678/webhook/source -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"job_order_id\":\"$JOB_ID\",\"sourcing_run_id\":\"$RUN_ID\"}"
echo

wait_for "sourcing run reaches a terminal phase" \
  "$PSQL \"select count(*) from sourcing_runs where id='$RUN_ID' and phase in ('done','failed')\"" 1
echo "run outcome:"
$PSQL "select phase, stats, coalesce(error,'') from sourcing_runs where id='$RUN_ID'"
# Without JobDiva creds the thin-check branch must soft-fail (jobdiva_error in stats)
# and still complete — 'done' with applications created proves the whole loop.
wait_for "sourced applications exist for the job" \
  "$PSQL \"select count(*) from applications where job_order_id='$JOB_ID'\"" 1
```

- [ ] **Step 5: Run the shell test**

Run: `./n8n/tests/sourcing-screening.sh` (requires docker n8n + dev server + seeded pool per the script's header comment).
Expected: all `wait_for` lines print `OK`, run phase ends `done`.

- [ ] **Step 6: Commit**

```bash
git add n8n/workflows/src/helpers.js n8n/workflows/src/sourcing.workflow.mjs n8n/tests/sourcing-screening.sh
git commit -m "feat: sourcing workflow reports run phases, reuses job embeddings, falls back to JobDiva when thin"
```

---

### Task 10: SourcingPanel on the job page

**Files:**
- Create: `src/app/jobs/[id]/SourcingPanel.tsx`
- Modify: `src/app/jobs/[id]/page.tsx`
- Test: `src/app/jobs/[id]/SourcingPanel.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `POST`/`GET /api/jobs/[id]/source` (Task 8). GET response shape: `{ run: { id, phase, stats, error } | null, shortlist: Array<{ candidate_id, full_name, current_title, distance, fit_rating }> | null }`.
- Produces: `<SourcingPanel jobId={string} autoStart={boolean} />` client component.

- [ ] **Step 1: Write the failing component test**

Create `src/app/jobs/[id]/SourcingPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourcingPanel from './SourcingPanel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function jsonRes(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => fetchMock.mockReset());

describe('SourcingPanel', () => {
  it('shows the Source button when idle', async () => {
    fetchMock.mockReturnValue(jsonRes({ run: null, shortlist: null }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByRole('button', { name: /source candidates/i })).toBeEnabled();
  });

  it('shows phase progress for an active run and disables the button', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'checking_jobdiva', stats: { pool_matches: 2 }, error: null },
      shortlist: null,
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText(/checking jobdiva/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sourcing/i })).toBeDisabled();
  });

  it('renders the shortlist with fit badges when done', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'done', stats: { shortlisted: 1 }, error: null },
      shortlist: [{
        candidate_id: 'c1', full_name: 'Ada L', current_title: 'Engineer',
        distance: 0.41, fit_rating: 'yes',
      }],
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText('Ada L')).toBeInTheDocument();
    expect(screen.getByText(/strong fit/i)).toBeInTheDocument();
  });

  it('shows the error and a retry button when failed', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'failed', stats: {}, error: 'Sourcing run timed out' , },
      shortlist: null,
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled();
  });

  it('POSTs on click', async () => {
    fetchMock.mockImplementation((url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? jsonRes({ sourcing_run_id: 'r9' }, 201)
        : jsonRes({ run: null, shortlist: null }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    await userEvent.click(await screen.findByRole('button', { name: /source candidates/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/jobs/j1/source', expect.objectContaining({ method: 'POST' }));
    });
  });
});
```

Note: if `@testing-library/user-event` is not installed, add it: `npm i -D @testing-library/user-event`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run 'src/app/jobs/[id]/SourcingPanel.test.tsx'`
Expected: FAIL — `Cannot find module './SourcingPanel'`.

- [ ] **Step 3: Write the component**

Create `src/app/jobs/[id]/SourcingPanel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Run = {
  id: string;
  phase: string;
  stats: Record<string, number | string | undefined> & { jobdiva_error?: string };
  error: string | null;
};
type ShortlistEntry = {
  candidate_id: string; full_name: string; current_title: string | null;
  distance: number; fit_rating: string | null;
};

const POLL_MS = 2500;
const TERMINAL = new Set(['done', 'failed']);

const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued…',
  searching_pool: 'Searching internal pool…',
  checking_jobdiva: 'Checking JobDiva…',
  embedding_new: 'Embedding new candidates…',
  shortlisting: 'Building shortlist…',
  screening: 'Handing off to screening…',
};

const FIT: Record<string, { label: string; tone: string }> = {
  yes: { label: 'Strong fit', tone: 'fit-good' },
  borderline: { label: 'Borderline', tone: 'fit-warn' },
  no: { label: 'Poor fit', tone: 'fit-bad' },
};

export default function SourcingPanel({ jobId, autoStart }: { jobId: string; autoStart: boolean }) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistEntry[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const prevPhase = useRef<string | null>(null);
  const autoFired = useRef(false);

  const active = run !== null && !TERMINAL.has(run.phase);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}/source`);
    if (!res.ok) return;
    const data = (await res.json()) as { run: Run | null; shortlist: ShortlistEntry[] | null };
    setRun(data.run);
    setShortlist(data.shortlist);
    setLoaded(true);
    // Refresh the server-rendered pipeline board once the run completes.
    if (data.run && data.run.phase === 'done' && prevPhase.current !== 'done') router.refresh();
    prevPhase.current = data.run?.phase ?? null;
  }, [jobId, router]);

  const start = useCallback(async () => {
    await fetch(`/api/jobs/${jobId}/source`, { method: 'POST' });
    await poll();
  }, [jobId, poll]);

  useEffect(() => { void poll(); }, [poll]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void poll(); }, POLL_MS);
    return () => clearInterval(t);
  }, [active, poll]);

  // ?source=1 after a JobDiva import: fire once, only when nothing is already running
  // (the server's 409 guard makes a stale bookmark harmless anyway).
  useEffect(() => {
    if (autoStart && loaded && !active && !autoFired.current) {
      autoFired.current = true;
      void start();
    }
  }, [autoStart, loaded, active, start]);

  const jd = run?.stats?.jobdiva_error;

  return (
    <section className="detail-panel">
      <div className="panel-head-row">
        <h2>Sourcing</h2>
        <button
          type="button"
          className="btn btn-primary"
          disabled={active}
          onClick={() => void start()}
        >
          {active ? 'Sourcing…' : run?.phase === 'failed' ? 'Retry' : 'Source candidates'}
        </button>
      </div>

      {run && !TERMINAL.has(run.phase) && (
        <p className="sourcing-status">
          <span className="dot working" aria-hidden="true" />
          {PHASE_LABEL[run.phase] ?? run.phase}
          {typeof run.stats?.pool_matches === 'number' && ` · ${run.stats.pool_matches} pool matches`}
          {typeof run.stats?.jobdiva_found === 'number' && ` · ${run.stats.jobdiva_found} JobDiva hits`}
          {typeof run.stats?.embedded === 'number' && ` · ${run.stats.embedded} embedded`}
        </p>
      )}

      {run?.phase === 'failed' && (
        <p className="sourcing-error">{run.error ?? 'Sourcing failed.'}</p>
      )}

      {typeof jd === 'string' && (
        <p className="sourcing-note">JobDiva unavailable — internal pool only.</p>
      )}

      {run?.phase === 'done' && shortlist !== null && shortlist.length === 0 && (
        <p className="empty">No matching candidates found — consider loosening the must-haves.</p>
      )}

      {shortlist !== null && shortlist.length > 0 && (
        <ol className="shortlist">
          {shortlist.map((s) => {
            const f = s.fit_rating ? FIT[s.fit_rating] : null;
            return (
              <li key={s.candidate_id} className="card shortlist-card">
                <Link href={`/candidates/${s.candidate_id}`} className="shortlist-name">
                  {s.full_name}
                </Link>
                {s.current_title && <span className="shortlist-title">{s.current_title}</span>}
                <span className="chip tnum">distance {Number(s.distance).toFixed(3)}</span>
                {f && <span className={`fit-badge ${f.tone}`}>{f.label}</span>}
              </li>
            );
          })}
        </ol>
      )}

      {loaded && run === null && shortlist === null && (
        <p className="empty">Not sourced yet.</p>
      )}
    </section>
  );
}
```

Class-name note: `panel-head-row`, `sourcing-status`, `sourcing-error`, `sourcing-note`, `shortlist`, `shortlist-card`, `shortlist-name`, `shortlist-title` are new — add minimal rules for them in the global stylesheet next to the existing `.detail-panel` styles (flex row for `panel-head-row`, muted text for status/note, standard card spacing for the list). Check `src/app/globals.css` (or wherever `.detail-panel` lives — grep for it) and follow the token layer; if an existing class already fits (e.g. `.empty`, `.chip`), prefer it.

- [ ] **Step 4: Mount it on the job page**

In `src/app/jobs/[id]/page.tsx`:

```tsx
import SourcingPanel from './SourcingPanel';
```

Change the signature to accept `searchParams` and mount the panel between the stats row (`rec-stats`) and the Requirements panel:

```tsx
export default async function JobPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  // ...existing body...
  const sp = await searchParams;
  // in JSX, after the rec-stats div:
  // <SourcingPanel jobId={id} autoStart={sp.source === '1'} />
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run 'src/app/jobs/[id]/SourcingPanel.test.tsx'` — expect PASS (5 tests).
Run: `npx tsc --noEmit` — expect no errors.

- [ ] **Step 6: Verify in the browser**

Start the dev server, open a job order page, click **Source candidates** (with docker n8n running): panel walks phases and lands on the shortlist; the pipeline board gains `sourced` cards after refresh. If n8n is stopped, the panel must show the "Couldn't reach the agent runtime" failure and re-enable the button.

- [ ] **Step 7: Commit**

```bash
git add 'src/app/jobs/[id]' src/app/globals.css package.json package-lock.json
git commit -m "feat: live Sourcing panel on the job page (phases, shortlist, retry)"
```

(Include the stylesheet actually touched; adjust the path if the project keeps panel styles elsewhere.)

---

### Task 11: Source-from-JobDiva form on /jobs

**Files:**
- Create: `src/app/jobs/SourceFromJobDiva.tsx`
- Modify: `src/app/jobs/page.tsx`
- Test: `src/app/jobs/SourceFromJobDiva.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `POST /api/jobs/import` (Task 8) → `{ job_order_id, created }` | error body `{ error, message? }`.
- Produces: `<SourceFromJobDiva />` client component; on success navigates to `/jobs/${job_order_id}?source=1`.

- [ ] **Step 1: Write the failing test**

Create `src/app/jobs/SourceFromJobDiva.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourceFromJobDiva from './SourceFromJobDiva';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => { fetchMock.mockReset(); push.mockReset(); });

describe('SourceFromJobDiva', () => {
  it('imports and navigates to the job with sourcing auto-start', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ job_order_id: 'j-9', created: true }), { status: 200 }));
    render(<SourceFromJobDiva />);
    await userEvent.type(screen.getByPlaceholderText(/jobdiva job/i), 'JD-42');
    await userEvent.click(screen.getByRole('button', { name: /source/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs/j-9?source=1'));
  });

  it('renders an inline error for an unknown number', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'job_not_found_in_jobdiva' }), { status: 404 }));
    render(<SourceFromJobDiva />);
    await userEvent.type(screen.getByPlaceholderText(/jobdiva job/i), 'JD-00');
    await userEvent.click(screen.getByRole('button', { name: /source/i }));
    expect(await screen.findByText(/not found in JobDiva/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('renders an inline error when JobDiva is down', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'jobdiva_unavailable' }), { status: 502 }));
    render(<SourceFromJobDiva />);
    await userEvent.type(screen.getByPlaceholderText(/jobdiva job/i), 'JD-42');
    await userEvent.click(screen.getByRole('button', { name: /source/i }));
    expect(await screen.findByText(/JobDiva is unavailable/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/jobs/SourceFromJobDiva.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/app/jobs/SourceFromJobDiva.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ERROR_COPY: Record<string, string> = {
  job_not_found_in_jobdiva: 'That job number was not found in JobDiva.',
  jobdiva_unavailable: 'JobDiva is unavailable right now — try again in a minute.',
};

export default function SourceFromJobDiva() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/jobs/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobdiva_job_number: value.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(ERROR_COPY[body.error] ?? 'Import failed — try again.');
        return;
      }
      router.push(`/jobs/${body.job_order_id}?source=1`);
    } catch {
      setError('Import failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="jd-source-form" onSubmit={submit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="JobDiva job #"
        aria-label="JobDiva job number"
      />
      <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
        {busy ? 'Importing…' : 'Source'}
      </button>
      {error && <p className="sourcing-error">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Mount on `/jobs`**

In `src/app/jobs/page.tsx`, import and render it inside the `page-head` div, after the lede paragraph:

```tsx
import SourceFromJobDiva from './SourceFromJobDiva';
// ...
        <p className="page-lede">
          Every active mandate the agents are working — coverage and pipeline depth at a glance.
        </p>
        <SourceFromJobDiva />
```

Add a `.jd-source-form` rule (inline flex row, gap, standard input styling) next to the other form styles in the global stylesheet.

- [ ] **Step 5: Run tests, verify pass, check the page renders**

Run: `npx vitest run src/app/jobs/SourceFromJobDiva.test.tsx` — expect PASS (3 tests).
Run: `npx tsc --noEmit` — expect clean. Load `/jobs` in the dev server and confirm the form renders in place.

- [ ] **Step 6: Commit**

```bash
git add src/app/jobs src/app/globals.css
git commit -m "feat: JobDiva job-number import form on the jobs page"
```

---

### Task 12: Playwright e2e

**Files:**
- Create: `playwright.config.ts`, `e2e/auth.setup.ts`, `e2e/source-flow.spec.ts`, `e2e/import-job.spec.ts`, `scripts/e2e/fake-n8n.mjs`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Consumes: seeded dev login `rick@sundayaiwork.com` / `change-me-locally` (from `src/db/seed.ts`); seeded agent key `dev-agent-key-change-me` (used by `n8n/tests/lib.sh`, so the seed provides it — verify in `src/db/seed.ts` and adjust the constant below if the seeded key differs); the app API surface from Tasks 3, 4, 8.
- Produces: `npm run test:e2e` covering both recruiter journeys with n8n and JobDiva stubbed by `fake-n8n.mjs` (port 5679).

- [ ] **Step 1: Install Playwright**

Run:

```bash
npm i -D @playwright/test
npx playwright install chromium
```

Add to `package.json` scripts:

```json
"test:e2e": "playwright test"
```

Append to `.gitignore`:

```
/test-results/
/playwright-report/
/e2e/.auth/
```

- [ ] **Step 2: Write the fixture server**

Create `scripts/e2e/fake-n8n.mjs`:

```js
// Stub for e2e runs: plays n8n (drives a sourcing run through its phases via the real
// agent API) and JobDiva (auth + getJob). Port 5679. Not used outside `npm run test:e2e`.
import http from 'node:http';

const API = process.env.AGENCY_API_URL ?? 'http://localhost:3000';
const KEY = process.env.AGENT_API_KEY ?? 'dev-agent-key-change-me';
const HEADERS = { 'content-type': 'application/json', 'x-agent-api-key': KEY };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apiPost = (path, body) =>
  fetch(API + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }).then((r) => r.json());
const apiPatch = (path, body) =>
  fetch(API + path, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(body) }).then((r) => r.json());

async function driveSourcingRun({ org_id, job_order_id, sourcing_run_id }) {
  const patch = (p) => apiPatch(`/api/agent/sourcing-runs/${sourcing_run_id}`, p);
  await patch({ phase: 'searching_pool' });
  await sleep(300);
  await patch({ phase: 'checking_jobdiva', stats: { pool_matches: 2 } });
  await sleep(300);
  await patch({ phase: 'embedding_new', stats: { jobdiva_found: 3, embedded: 2 } });

  // Two fresh candidates via the real ingest endpoint, so the shortlist links resolve.
  const suffix = Date.now();
  const c1 = await apiPost('/api/agent/candidates', {
    full_name: `E2E Ada ${suffix}`, email: `ada-${suffix}@e2e.test`, source: 'jobdiva',
  });
  const c2 = await apiPost('/api/agent/candidates', {
    full_name: `E2E Grace ${suffix}`, email: `grace-${suffix}@e2e.test`, source: 'jobdiva',
  });
  const ranked = [c1, c2].map((c, i) => ({
    candidate_id: c.candidate_id, full_name: i === 0 ? `E2E Ada ${suffix}` : `E2E Grace ${suffix}`,
    current_title: 'Engineer', distance: 0.3 + i * 0.05,
  }));

  await patch({ phase: 'shortlisting', stats: { shortlisted: ranked.length } });
  const d = await apiPost('/api/agent/decisions', {
    agent: 'sourcing', action_class: 'source.shortlist',
    reasoning: { summary: 'e2e shortlist', evidence: [], model: 'e2e', prompt_version: 'e2e-v1' },
    payload: { candidate_ids: ranked.map((r) => r.candidate_id), ranked },
    job_order_id,
  });
  await apiPost(`/api/agent/decisions/${d.decision.id}/transition`, { to: 'executing', actor: 'sourcing' });
  await apiPost(`/api/agent/decisions/${d.decision.id}/transition`, { to: 'executed', actor: 'sourcing', outcome: {} });
  await apiPost('/api/agent/applications', {
    job_order_id, candidate_ids: ranked.map((r) => r.candidate_id),
  });
  await patch({ phase: 'done' });
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://localhost:5679');

    if (url.pathname === '/webhook/source') {
      res.writeHead(200).end('{}');
      const body = JSON.parse(raw || '{}');
      driveSourcingRun(body).catch((err) => console.error('fake-n8n drive failed:', err));
      return;
    }
    // JobDiva stub — paths mirror ENDPOINTS in src/services/jobdiva.ts under /jobdiva.
    if (url.pathname === '/jobdiva/api/authenticate') {
      res.writeHead(200).end('fake-token');
      return;
    }
    if (url.pathname === '/jobdiva/apiv2/jobdiva/getJobById') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{
        title: 'Imported: Platform Engineer', description: 'From the JobDiva stub',
        skills: ['Kubernetes', 'Go'], jobType: 'Contract',
      }]));
      return;
    }
    res.writeHead(404).end('not found');
  });
});

server.listen(5679, () => console.log('fake-n8n listening on :5679'));
```

Note: verify the decision-transition request bodies against `src/app/api/agent/decisions/[id]/transition/route.ts` and the propose body against `src/app/api/agent/decisions/route.ts` (and the candidate-ingest body against `src/app/api/agent/candidates/route.ts`) — mirror what the real n8n helpers send; adjust the three `apiPost` payloads above to match exactly what those routes validate.

- [ ] **Step 3: Write the Playwright config + auth setup**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: [
    {
      command: 'node scripts/e2e/fake-n8n.mjs',
      port: 5679,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      env: {
        N8N_WEBHOOK_URL: 'http://localhost:5679/webhook',
        JOBDIVA_BASE_URL: 'http://localhost:5679/jobdiva',
        JOBDIVA_CLIENT_ID: 'e2e', JOBDIVA_USERNAME: 'e2e', JOBDIVA_PASSWORD: 'e2e',
      },
    },
  ],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { storageState: 'e2e/.auth/user.json' },
    },
  ],
});
```

Create `e2e/auth.setup.ts`:

```ts
import { test as setup } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill('rick@sundayaiwork.com');
  await page.getByPlaceholder('Password').fill('change-me-locally');
  await page.getByRole('button').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
```

(Check the login page's submit-button text and post-login redirect; adjust the locator/waitForURL accordingly.)

- [ ] **Step 4: Write the two journey specs**

Create `e2e/source-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('recruiter sources candidates from the job page', async ({ page }) => {
  await page.goto('/jobs');
  await page.locator('.jo-card').first().click();

  await page.getByRole('button', { name: /source candidates|retry/i }).click();

  // Phase progress appears, then the shortlist.
  await expect(page.locator('.sourcing-status')).toBeVisible();
  await expect(page.locator('.shortlist-card').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/E2E Ada/)).toBeVisible();

  // The pipeline board gains sourced cards after the auto-refresh.
  await expect(
    page.locator('.pipeline-col.stage-sourced .pipeline-card').first(),
  ).toBeVisible({ timeout: 15_000 });
});
```

Create `e2e/import-job.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('recruiter imports a JobDiva job by number and sourcing auto-starts', async ({ page }) => {
  await page.goto('/jobs');
  await page.getByPlaceholder('JobDiva job #').fill(`JD-${Date.now()}`);
  await page.getByRole('button', { name: 'Source' }).click();

  await page.waitForURL(/\/jobs\/[0-9a-f-]+\?source=1/);
  await expect(page.getByRole('heading', { name: /Imported: Platform Engineer/ })).toBeVisible();
  // Auto-started run shows progress, then completes.
  await expect(page.locator('.shortlist-card').first()).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Step 5: Run e2e**

Run (needs docker Postgres up and a seeded DB):

```bash
npm run db:reseed
npm run test:e2e
```

Expected: 1 setup + 2 tests PASS. Debug failures with `npx playwright test --ui`; check `scripts/e2e/fake-n8n.mjs` console output for API errors (a mismatch with the decisions/candidates route schemas is the most likely culprit — fix the fixture payloads, not the routes).

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e scripts/e2e package.json package-lock.json .gitignore
git commit -m "feat: Playwright e2e for both sourcing journeys with stubbed n8n + JobDiva"
```

---

### Task 13: docs — glossary + env

**Files:**
- Modify: `CONTEXT.md`, `README.md` (if it documents env/setup — check)

**Interfaces:** none (documentation).

- [ ] **Step 1: Add the Sourcing Run glossary entry to `CONTEXT.md`**

Insert after the **Agent run** entry:

```markdown
### Sourcing run

One recruiter-visible execution of the sourcing flow for a job order, created when a
recruiter clicks **Source candidates** (or imports a JobDiva job number). Tracks a
`phase` (`queued → searching_pool → checking_jobdiva → embedding_new → shortlisting →
screening → done | failed`) that the n8n sourcing workflow advances and the job page
polls.

**Invariants:**
- At most one non-terminal Sourcing run per job order at a time.
- The internal pool is always searched before JobDiva; JobDiva is only called when
  fewer than 10 good matches (cosine distance < 0.55) exist internally.
- A JobDiva failure never fails the run — it degrades to internal-only results.
- A non-terminal run untouched for 10 minutes is presumed dead and reported failed.

**Distinguishes from:** Agent run — an Agent run is one model-call's telemetry; a
Sourcing run is the recruiter-facing progress record spanning the whole flow.
```

- [ ] **Step 2: Check README/setup docs for an env-var section**

If `README.md` (or `docs/deployment.md`) lists env vars, add `N8N_WEBHOOK_URL` and `JOBDIVA_BASE_URL` with one-line descriptions matching `.env.example`.

- [ ] **Step 3: Full verification pass**

```bash
npm test          # full vitest suite
npx tsc --noEmit  # typecheck
npm run lint      # eslint
```

Expected: all green (modulo the known backfill-embeddings flake).

- [ ] **Step 4: Commit**

```bash
git add CONTEXT.md README.md docs
git commit -m "docs: Sourcing run glossary entry + new env vars"
```

---

## Self-Review (done at plan time)

- **Spec coverage:** entry points (Tasks 8, 10, 11), internal-first + thin check (Task 9), targeted JobDiva pull with dedupe/embed-only-new + resume cap (Tasks 6, 7), live job-page results with polling + Decision to Cockpit (Tasks 9, 10), sourced Applications (Tasks 4, 9), job-embedding reuse (Tasks 5, 9), staleness guard / soft JobDiva failure / per-candidate isolation / empty shortlist / 409 concurrency (Tasks 2, 7, 8, 9, 10), Vitest + n8n shell + Playwright + smoke script (throughout, 12), env + glossary (6, 8, 13).
- **Deliberate deviation from spec:** the spec's n8n shell test suggested stubbing JobDiva via env-pointed base URL; the plan instead asserts the *soft-fail* path (no creds → `jobdiva_error` recorded → run still completes) which exercises the same branch with less machinery. The stubbed-success path is covered by Vitest (Task 7) and Playwright (Task 12).
- **Type consistency:** `SourcingPhase` strings identical across service, route schema, workflow, panel, shell test, glossary; `ShortlistEntry` shape identical in service, GET route, panel; webhook body `{ org_id, job_order_id, sourcing_run_id }` identical in route, lib, workflow, fixture; stats keys (`pool_matches`, `jobdiva_found`, `jobdiva_new`, `embedded`, `shortlisted`, `skipped`, `jobdiva_error`) identical across service, workflow, panel.
- **Known verify-at-build points (explicitly flagged in steps):** JobDiva `ENDPOINTS` + mappers (Task 6 Step 6); `users` export name in core schema (Task 1); fixture payloads vs. decisions/candidates route schemas (Task 12 Step 2); login-page locators (Task 12 Step 3); stylesheet location for new classes (Tasks 10, 11).
