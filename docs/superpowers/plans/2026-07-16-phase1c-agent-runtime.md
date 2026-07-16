# Phase 1c — Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design:** `docs/superpowers/specs/2026-07-16-phase1c-agent-runtime-design.md` — adapts the
source plan below rather than re-deriving it; read that first for the corrections applied here.

**Goal:** Stand up the n8n agent runtime — Orchestrator, Data Steward, Sourcing + Screening (ported from the validated pipeline), and the email-only Communication Agent behind the Compliance gate — completing the Phase 1 loop: *job order in → scored shortlist with approvable outreach out → approved email actually sent*.

**Architecture:** n8n (local Docker) hosts the agents; each agent is a workflow defined **as code** in the repo (`n8n/workflows/src/*.workflow.mjs`), compiled to importable JSON and loaded via the n8n CLI. Agents touch the world **only** through the app's API-key-authed `/api/agent/*` surface — n8n never opens a database connection. The first six tasks extend that Next.js surface (execution lifecycle, comms logging, compliance gate, ingest, matching, scorer assets); the rest build and golden-test the workflows against it. Mailpit is the dev email transport (swapped for SES in Plan 1d by changing one env var).

**Tech Stack:** n8n (Docker, workflows-as-code via Code nodes), Mailpit (dev SMTP catcher with HTTP send API), Gemini (`gemini-embedding-001` @ 3072 dims, `gemini-2.5-flash` scoring/drafting), Next.js API routes + Drizzle (from 1a), Vitest, bash golden-path scripts.

**Spec:** `/Users/richardlove/Desktop/Projects/Claude/Agentic_Recruiting/01-architecture/agentic-agency-greenfield-design_2026-07-09.md`
**Source plan (patched 2026-07-16):** `/Users/richardlove/Desktop/Projects/Claude/Agentic_Recruiting/01-architecture/phase1c-agents-plan_2026-07-09.md`
**Builds on:** Plans 1a and 1b (same repo, `AgencyOS`) — both complete and green on `main` as of this plan (decision store, contracts, session auth, cockpit, ATS views).
**Ported assets (hub paths):**
- Scorer prompts: `/Users/richardlove/Desktop/Projects/Claude/Agentic_Recruiting/04-scoring-calibration/scorer-prompts-snapshot_2026-07-09.json` (exported from live Supabase 2026-07-09)
- Parse/gate logic: `/Users/richardlove/Desktop/Projects/Claude/Agentic_Recruiting/03-workflows-n8n/slice05-parse-score-output-restored.js` (v2.2.0 scorer + C01-hard-gate-v2)

## Global Constraints

- Repo: `/Users/richardlove/Desktop/Projects/AgencyOS`. Preconditions: `docker compose up -d`, `npm run db:migrate`, `npm run db:seed`, `npm test` green; `npm run dev` running for all n8n golden tests.
- **Agents never touch tables** — every n8n interaction goes through `/api/agent/*` with the `x-agent-api-key` header. No Postgres credentials in n8n.
- **Every agent action is a decision record.** Tier-1 work: propose → do the work → transition `executing` → `executed` with outcome (proposer completes its own record). Tier-2/3 execution: only the Communication Agent executes `comms.*` decisions, after the undo window, behind the Compliance gate; deny reasons land on the decision record (spec §3, §4).
- **Compliance verdicts:** `deny` (permanent — decision → `failed` with `compliance_denied:` error), `defer` (temporary — quiet hours / frequency cap; decision stays `approved`, retried next poll), `allow`.
- **Scorer:** seed both `v2.2.0` and `v2.3.0`; **`v2.2.0` is active** — it is the spec's "v1 brain" (81.3% baseline, CAL-0002). v2.3.0's grounded C11 needs structured pay fields that arrive with the JobDiva migration (Plan 1d); flip `active` then (CAL-0003).
- Email only; transport = HTTP POST to `MAIL_API_URL` (Mailpit dev, SES in 1d). LinkedIn/SMS/voice out of scope.
- `GEMINI_API_KEY` required in `.env` (n8n container reads it via compose). Golden tests call the live Gemini API — assertions are structural (rows exist, fields present), never exact model outputs.
- Every LLM call logs to `agent_runs` via `POST /api/agent/runs` (spec §5: one abstraction, model + prompt version + tokens).
- Zod v4 (`z.email()`, `z.uuid()`, `.issues`); env via `getEnv()`; `org_id` on everything; relative imports; commit after every task.
- **`transitionDecision` already has an ADR-0003 compare-and-swap guard and ADR-0002 `cancelled_by`/`cancelled_at` handling** ([src/services/decision-store.ts](../../../src/services/decision-store.ts)) — Task 1 *extends* this function, it does not replace it. Losing the CAS guard breaks Task 1's own race test and Task 12's per-decision isolation.
- `embeddings.subject_type` values are `'candidate_document' | 'job_order'` (schema comment already corrected; no migration needed — it's a bare `text` column).
- n8n image behaviors flagged inline (import `--separate`, custom workflow ids, `$env`/`this.helpers.httpRequest` in Code nodes) — verify against the installed n8n version at build time; **pin the image to that exact tag**, don't run `:latest`.

## File Structure

```
AgencyOS/ (additions; M = modify)
├── docker-compose.yml                          M  + n8n, mailpit services
├── .env / .env.example                         M  + GEMINI_API_KEY
├── .gitignore                                  M  + n8n/dist/
├── vitest.config.ts                            M  include n8n/**/*.test.ts
├── src/
│   ├── lib/agent-auth.ts                          requireAgentKey(req)
│   ├── services/
│   │   ├── decision-store.ts                   M  + listExecutable; transitionDecision extras (keep CAS guard)
│   │   ├── decision-store.test.ts              M  append
│   │   ├── agent-runs.ts / comms-log.ts / compliance.ts / ingest.ts / matching.ts  (+ .test.ts each)
│   ├── db/seed.ts                              M  + scorer prompt upsert
│   └── app/api/agent/
│       ├── decisions/route.ts                  M  fold onto requireAgentKey (drop local unauthorized())
│       ├── decisions/executable/route.ts          GET  executable work
│       ├── decisions/[id]/transition/route.ts     POST state transitions
│       ├── runs/route.ts                          POST telemetry
│       ├── messages/route.ts                      POST log message
│       ├── consents/route.ts                      GET  consent status
│       ├── prompts/route.ts                       GET  active system prompt
│       ├── compliance/check/route.ts              POST gate verdict
│       ├── candidates/route.ts                    POST ingest (dedupe)
│       ├── candidates/[id]/route.ts               GET  candidate + latest resume
│       ├── embeddings/route.ts                    POST upsert chunks
│       ├── search/candidates/route.ts             POST vector search
│       ├── job-orders/[id]/route.ts               GET  job order
│       └── scores/route.ts                        POST score row
└── n8n/
    ├── build.mjs                                  compiles src → dist JSON
    ├── apply.sh                                   build + import + restart
    ├── lib/parse-score-output.js (+ .test.ts)     ported v2.2.0 parse + C01 gate
    ├── prompts/scorer-prompts-snapshot_2026-07-09.json   copied from hub
    ├── workflows/src/
    │   ├── lib.mjs                                node/workflow builders
    │   ├── helpers.js                             Code-node prelude (api/gemini/chunk helpers)
    │   ├── heartbeat.workflow.mjs
    │   ├── orchestrator.workflow.mjs
    │   ├── data-steward.workflow.mjs
    │   ├── sourcing.workflow.mjs
    │   ├── screening.workflow.mjs
    │   └── communication.workflow.mjs
    └── tests/
        ├── lib.sh                                 curl/psql helpers, wait_for
        ├── orchestrator.sh · data-steward.sh · sourcing-screening.sh · communication.sh · e2e-golden-path.sh
```

---

### Task 1: Execution lifecycle API — executable list, transitions, run telemetry

**Files:**
- Create: `src/lib/agent-auth.ts`, `src/services/agent-runs.ts`, `src/app/api/agent/decisions/executable/route.ts`, `src/app/api/agent/decisions/[id]/transition/route.ts`, `src/app/api/agent/runs/route.ts`
- Modify: `src/services/decision-store.ts` (add `listExecutable`; extend `transitionDecision` — **keep its existing CAS guard**), `src/app/api/agent/decisions/route.ts` (fold onto the new shared auth helper)
- Test: `src/services/decision-store.test.ts` (append), `src/services/agent-runs.test.ts`, `src/app/api/agent/decisions/executable/route.test.ts` (covers both new decision routes)

**Interfaces:**
- Consumes: `decisions`, `agent_runs` tables; `canTransition`; `AGENTS` from the contract; `getEnv`.
- Produces:
  - `requireAgentKey(req: Request): Response | null` — 401 response or null; every agent route (new and existing) uses it.
  - `listExecutable(opts?: { orgId?: string; actionPrefix?: string }): Promise<DecisionRow[]>` — `approved` decisions whose undo window is absent or expired, oldest first.
  - `transitionDecision(id, to, actor, extras?: { error?: string | null; outcome?: unknown })` — extended (backward-compatible): sets `error` on `failed`, `outcome` on `executed`. **Still guards with the existing compare-and-swap `where(and(eq(id), eq(state, from)))` and still throws "already transitioned by another process" on a lost race** — do not remove this.
  - `insertAgentRun(input: unknown): Promise<AgentRunRow>` with `AgentRunSchema`.
  - HTTP: `GET /api/agent/decisions/executable?org_id=&action_prefix=` → `{ queue }`; `POST /api/agent/decisions/:id/transition` `{ to, actor, error?, outcome? }` → `{ decision }` (400 zod / 404 missing / 409 illegal transition **or** lost compare-and-swap race — ADR-0003's error is matched separately so it isn't swallowed by the generic 500 branch; Task 12's executor relies on getting a 409 here, not a 500, to tell "someone else already resolved this" apart from a real failure); `POST /api/agent/runs` → 201 `{ run }`.

- [ ] **Step 1: Append failing decision-store tests**

Append to `src/services/decision-store.test.ts` (uses the existing `sql`, `orgId`, `proposal` helpers in that file):

```ts
import { listExecutable } from './decision-store';

describe('listExecutable', () => {
  it('includes expired-undo tier-2 and null-undo tier-1, excludes future-undo and proposed', async () => {
    const t1 = await proposeDecision(proposal('screen.score_resume'));       // approved, undo null
    const t2live = await proposeDecision(proposal('comms.candidate_outreach')); // approved, undo future
    const t2done = await proposeDecision(proposal('comms.candidate_outreach'));
    await sql`update decisions set undo_expires_at = now() - interval '1 minute' where id = ${t2done.id}`;
    const t3 = await proposeDecision(proposal('client.submit_candidate'));   // proposed

    const ids = (await listExecutable({ orgId })).map((d) => d.id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2done.id);
    expect(ids).not.toContain(t2live.id);
    expect(ids).not.toContain(t3.id);
  });

  it('filters by action prefix', async () => {
    const t1 = await proposeDecision(proposal('screen.score_resume'));
    const ids = (await listExecutable({ orgId, actionPrefix: 'comms.' })).map((d) => d.id);
    expect(ids).not.toContain(t1.id);
  });
});

describe('transitionDecision extras', () => {
  it('records error on failed and outcome on executed', async () => {
    const a = await proposeDecision(proposal('screen.score_resume')); // approved
    const executing = await transitionDecision(a.id, 'executing', 'screening');
    const failed = await transitionDecision(executing.id, 'failed', 'screening', { error: 'boom' });
    expect(failed.error).toBe('boom');

    const b = await proposeDecision(proposal('screen.score_resume'));
    await transitionDecision(b.id, 'executing', 'screening');
    const done = await transitionDecision(b.id, 'executed', 'screening', { outcome: { ok: true } });
    expect(done.outcome).toEqual({ ok: true });
    expect(done.executed_at).not.toBeNull();
  });

  it('still 409s on a lost compare-and-swap race (ADR-0003 must survive the extras change)', async () => {
    const d = await proposeDecision(proposal('comms.candidate_outreach')); // approved
    const [a, b] = await Promise.allSettled([
      transitionDecision(d.id, 'executing', 'communication'),
      transitionDecision(d.id, 'cancelled', 'user-1'),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason.message).toMatch(/already transitioned by another process/);
  });
});
```

Run: `npm test -- src/services/decision-store.test.ts`
Expected: FAIL — `listExecutable` not exported; extras ignored; the race test fails too (nothing throws yet since `transitionDecision` doesn't accept `extras` and TypeScript will reject the 4-arg call).

- [ ] **Step 2: Implement the service changes**

In `src/services/decision-store.ts`, extend the drizzle import to `{ and, asc, desc, eq, gt, isNull, like, lte, or }`.

Replace the current `transitionDecision` with this — it keeps the existing CAS guard and
`cancelled_by`/`cancelled_at` handling, and only adds the `extras` parameter and the
`error`/`outcome` patch fields:

```ts
export async function transitionDecision(
  id: string,
  to: DecisionState,
  actor: string,
  extras: { error?: string | null; outcome?: unknown } = {},
): Promise<DecisionRow> {
  const [current] = await db.select().from(decisions).where(eq(decisions.id, id));
  if (!current) throw new Error(`Decision not found: ${id}`);
  const from = current.state as DecisionState;
  if (!canTransition(from, to)) throw new Error(`Invalid transition ${from} → ${to}`);

  const patch: Partial<typeof decisions.$inferInsert> = { state: to };
  if (to === 'approved') { patch.approved_by = actor; patch.decided_at = new Date(); }
  if (to === 'cancelled') {
    patch.cancelled_by = actor;
    patch.cancelled_at = new Date();
    // A proposed→cancelled rejection IS the decision; an approved→cancelled undo must not
    // overwrite the original policy/human approval timestamp (ADR-0002).
    if (!current.decided_at) patch.decided_at = new Date();
  }
  if (to === 'failed') { patch.error = extras.error ?? null; }
  if (to === 'executed') {
    patch.executed_at = new Date();
    if (extras.outcome !== undefined) patch.outcome = extras.outcome;
  }

  // Compare-and-swap on state: guards against a concurrent transition (e.g. Plan 1c's
  // executor and a human Undo click racing on the same row) silently overwriting each
  // other. Whichever caller loses the race gets a thrown error instead of a lost update
  // (ADR-0003).
  const [row] = await db.update(decisions).set(patch)
    .where(and(eq(decisions.id, id), eq(decisions.state, from)))
    .returning();
  if (!row) {
    throw new Error(`Decision ${id} was already transitioned by another process (expected state ${from})`);
  }
  return row;
}
```

Add at the end of the file:

```ts
/** Approved decisions whose undo window is absent or expired — ready for a capability agent. */
export async function listExecutable(
  opts: { orgId?: string; actionPrefix?: string } = {},
): Promise<DecisionRow[]> {
  const conds = [
    eq(decisions.state, 'approved'),
    or(isNull(decisions.undo_expires_at), lte(decisions.undo_expires_at, new Date())),
  ];
  if (opts.orgId) conds.push(eq(decisions.org_id, opts.orgId));
  if (opts.actionPrefix) conds.push(like(decisions.action_class, `${opts.actionPrefix}%`));
  return db.select().from(decisions).where(and(...conds)).orderBy(asc(decisions.proposed_at));
}
```

Run: `npm test -- src/services/decision-store.test.ts` → PASS (all, old and new — including the race test).

- [ ] **Step 3: Auth helper + agent-runs service (failing test first)**

Create `src/services/agent-runs.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { insertAgentRun } from './agent-runs';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

describe('insertAgentRun', () => {
  it('inserts a run with model telemetry', async () => {
    const run = await insertAgentRun({
      org_id: orgId, agent: 'screening', workflow: 'agencyos-screening',
      model: 'gemini-2.5-flash', prompt_version: 'v2.2.0',
      tokens_in: 1200, tokens_out: 300, status: 'succeeded',
    });
    expect(run.id).toBeTruthy();
    expect(run.finished_at).not.toBeNull();
  });

  it('rejects an unknown agent', async () => {
    await expect(insertAgentRun({ org_id: orgId, agent: 'nope', workflow: 'w' })).rejects.toThrow();
  });
});
```

Run: `npm test -- src/services/agent-runs.test.ts` → FAIL (module missing).

Create `src/lib/agent-auth.ts`:

```ts
import { getEnv } from './env';

/** Shared guard for /api/agent/* routes. Returns a 401 response or null to proceed. */
export function requireAgentKey(req: Request): Response | null {
  if (req.headers.get('x-agent-api-key') !== getEnv('AGENT_API_KEY')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
```

Create `src/services/agent-runs.ts`:

```ts
import { z } from 'zod';
import { db } from '../db/client';
import { agent_runs } from '../db/schema';
import { AGENTS } from '../contracts/decision';

export const AgentRunSchema = z.strictObject({
  org_id: z.uuid(),
  agent: z.enum(AGENTS),
  workflow: z.string().min(1),
  model: z.string().nullable().default(null),
  prompt_version: z.string().nullable().default(null),
  tokens_in: z.number().int().nullable().default(null),
  tokens_out: z.number().int().nullable().default(null),
  status: z.string().default('succeeded'),
  decision_id: z.uuid().nullable().default(null),
});

export type AgentRunRow = typeof agent_runs.$inferSelect;

export async function insertAgentRun(input: unknown): Promise<AgentRunRow> {
  const p = AgentRunSchema.parse(input);
  const [row] = await db.insert(agent_runs).values({ ...p, finished_at: new Date() }).returning();
  return row;
}
```

Run: `npm test -- src/services/agent-runs.test.ts` → PASS (2 tests).

- [ ] **Step 4: Routes (failing test first)**

Create `src/app/api/agent/decisions/executable/route.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../../../../../lib/env';
import { proposeDecision } from '../../../../../services/decision-store';
import { GET } from './route';
import { POST as TRANSITION } from '../[id]/transition/route';
import { POST as RUNS } from '../../runs/route';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
const KEY = getEnv('AGENT_API_KEY');
let orgId: string;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

const proposal = () => ({
  org_id: orgId, agent: 'screening', action_class: 'comms.candidate_outreach',
  reasoning: { summary: 'route test', evidence: [], model: 'm', prompt_version: 'v' },
  payload: {},
});

describe('GET /api/agent/decisions/executable', () => {
  it('401 without key; 200 with expired-undo decision', async () => {
    const noKey = await GET(new Request('http://t/api/agent/decisions/executable'));
    expect(noKey.status).toBe(401);

    const d = await proposeDecision(proposal());
    await sql`update decisions set undo_expires_at = now() - interval '1 minute' where id = ${d.id}`;
    const res = await GET(new Request(
      `http://t/api/agent/decisions/executable?org_id=${orgId}&action_prefix=comms.`,
      { headers: { 'x-agent-api-key': KEY } },
    ));
    expect(res.status).toBe(200);
    const { queue } = await res.json();
    expect(queue.map((q: { id: string }) => q.id)).toContain(d.id);
  });
});

describe('POST /api/agent/decisions/:id/transition', () => {
  const call = (id: string, body: unknown) =>
    TRANSITION(new Request(`http://t/api/agent/decisions/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-api-key': KEY },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });

  it('walks executing → executed with outcome', async () => {
    const d = await proposeDecision(proposal()); // tier 2 → approved
    const r1 = await call(d.id, { to: 'executing', actor: 'communication' });
    expect(r1.status).toBe(200);
    const r2 = await call(d.id, { to: 'executed', actor: 'communication', outcome: { message_id: 'm1' } });
    const { decision } = await r2.json();
    expect(decision.state).toBe('executed');
    expect(decision.outcome).toEqual({ message_id: 'm1' });
  });

  it('409 on an illegal transition', async () => {
    const d = await proposeDecision(proposal());
    const res = await call(d.id, { to: 'undone', actor: 'x' });
    expect(res.status).toBe(409);
  });

  it('409 (not 500) when a concurrent transition already moved the decision', async () => {
    const d = await proposeDecision(proposal()); // tier 2 → approved
    // Both 'executing' and 'cancelled' are valid next states from 'approved' — this isn't
    // an illegal-transition 409, it's the ADR-0003 compare-and-swap race guard.
    const [a, b] = await Promise.allSettled([
      call(d.id, { to: 'executing', actor: 'communication' }),
      call(d.id, { to: 'cancelled', actor: 'user-1' }),
    ]);
    const responses = [a, b].map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean) as Response[];
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = responses.find((r) => r.status === 409)!;
    const body = await loser.json();
    expect(body.error).toMatch(/already transitioned by another process/);
  });
});

describe('POST /api/agent/runs', () => {
  it('201 on a valid run', async () => {
    const res = await RUNS(new Request('http://t/api/agent/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-api-key': KEY },
      body: JSON.stringify({ org_id: orgId, agent: 'sourcing', workflow: 'agencyos-sourcing', model: 'gemini-embedding-001' }),
    }));
    expect(res.status).toBe(201);
  });
});
```

Run: `npm test -- src/app/api/agent/decisions/executable/route.test.ts` → FAIL (modules missing).

Create `src/app/api/agent/decisions/executable/route.ts`:

```ts
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { listExecutable } from '../../../../../services/decision-store';

export async function GET(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const queue = await listExecutable({
    orgId: url.searchParams.get('org_id') ?? undefined,
    actionPrefix: url.searchParams.get('action_prefix') ?? undefined,
  });
  return Response.json({ queue });
}
```

Create `src/app/api/agent/decisions/[id]/transition/route.ts`:

```ts
import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../../lib/agent-auth';
import { transitionDecision } from '../../../../../../services/decision-store';
import { DECISION_STATES } from '../../../../../../contracts/decision';

const TransitionBodySchema = z.strictObject({
  to: z.enum(DECISION_STATES),
  actor: z.string().min(1),
  error: z.string().nullable().optional(),
  outcome: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const body = TransitionBodySchema.parse(await req.json());
    const decision = await transitionDecision(id, body.to, body.actor, {
      error: body.error, outcome: body.outcome,
    });
    return Response.json({ decision });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'internal_error';
    if (msg.startsWith('Invalid transition')) return Response.json({ error: msg }, { status: 409 });
    // ADR-0003's compare-and-swap race guard — the row moved between read and write
    // (e.g. a human cancelled it the same tick the executor picked it up). Same bucket
    // as "Invalid transition" (409, not the caller's fault, not a server error) — Task 12
    // needs to tell this apart from a real 500 to keep processing the rest of its batch.
    if (msg.includes('already transitioned by another process')) {
      return Response.json({ error: msg }, { status: 409 });
    }
    if (msg.startsWith('Decision not found')) return Response.json({ error: msg }, { status: 404 });
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

Create `src/app/api/agent/runs/route.ts`:

```ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { insertAgentRun } from '../../../../services/agent-runs';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    const run = await insertAgentRun(await req.json());
    return Response.json({ run }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Fold the existing decisions route onto the shared auth helper**

`src/app/api/agent/decisions/route.ts` currently defines its own local `unauthorized()` —
now that `requireAgentKey` exists, replace it so there's one auth check in the codebase.
Replace the whole file:

```ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { proposeDecision, listQueue } from '../../../../services/decision-store';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    const decision = await proposeDecision(await req.json());
    return Response.json({ decision }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const orgId = new URL(req.url).searchParams.get('org_id');
  if (!orgId) return Response.json({ error: 'org_id required' }, { status: 400 });
  try {
    return Response.json({ queue: await listQueue(orgId) });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

This is a pure refactor (same external behavior — the existing `route.test.ts` for this file
must still pass unmodified).

Run: `npm test -- src/app/api/agent/decisions/route.test.ts` → PASS (no test changes needed).

- [ ] **Step 6: Verify and commit**

```bash
npm test
git add -A
git commit -m "feat: execution lifecycle API — executable list, transitions with error/outcome, run telemetry"
```

Expected: full suite PASS.

---

### Task 2: Comms logging, consent, and prompt read APIs

**Files:**
- Create: `src/services/comms-log.ts`, `src/app/api/agent/messages/route.ts`, `src/app/api/agent/consents/route.ts`, `src/app/api/agent/prompts/route.ts`
- Test: `src/services/comms-log.test.ts`

**Interfaces:**
- Consumes: `conversations`, `messages`, `consents`, `system_prompts` tables; `requireAgentKey`.
- Produces:
  - `CHANNELS = ['email','sms','whatsapp','voice','linkedin'] as const` and `MessageLogSchema`.
  - `logMessage(input: unknown): Promise<{ conversation_id: string; message_id: string }>` — find-or-create the candidate+channel conversation, insert the message.
  - `countRecentOutbound(orgId, candidateId, channel, days = 7): Promise<number>` (Task 3's frequency cap).
  - `getConsentStatus(orgId, candidateId, channel): Promise<'granted' | 'revoked' | 'unknown'>`.
  - `getActivePrompt(orgId, agent, name): Promise<SystemPromptRow | null>`.
  - HTTP: `POST /api/agent/messages` → 201 `{ conversation_id, message_id }`; `GET /api/agent/consents?org_id=&candidate_id=&channel=` → `{ status }`; `GET /api/agent/prompts?org_id=&agent=&name=` → `{ prompt }` | 404.

- [ ] **Step 1: Write failing tests**

Create `src/services/comms-log.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { logMessage, countRecentOutbound, getConsentStatus, getActivePrompt } from './comms-log';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
let candidateId: string;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  candidateId = (await sql`
    insert into candidates (org_id, full_name, email)
    values (${orgId}, 'Comms Test', ${'comms-' + Date.now() + '@example.com'}) returning id`)[0].id;
});

describe('logMessage', () => {
  it('creates one conversation and reuses it for the second message', async () => {
    const a = await logMessage({ org_id: orgId, candidate_id: candidateId, channel: 'email', direction: 'outbound', body: 'first', decision_id: null });
    const b = await logMessage({ org_id: orgId, candidate_id: candidateId, channel: 'email', direction: 'outbound', body: 'second', decision_id: null });
    expect(a.conversation_id).toBe(b.conversation_id);
    expect(a.message_id).not.toBe(b.message_id);
  });
});

describe('countRecentOutbound', () => {
  it('counts the two outbound messages just logged', async () => {
    expect(await countRecentOutbound(orgId, candidateId, 'email')).toBe(2);
  });
});

describe('getConsentStatus', () => {
  it('is unknown with no row, revoked after revocation', async () => {
    expect(await getConsentStatus(orgId, candidateId, 'email')).toBe('unknown');
    await sql`insert into consents (org_id, candidate_id, channel, status) values (${orgId}, ${candidateId}, 'email', 'revoked')`;
    expect(await getConsentStatus(orgId, candidateId, 'email')).toBe('revoked');
  });
});

describe('getActivePrompt', () => {
  it('returns null when nothing is active under that name', async () => {
    expect(await getActivePrompt(orgId, 'screening', 'no-such-prompt')).toBeNull();
  });
});
```

Run: `npm test -- src/services/comms-log.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the service**

Create `src/services/comms-log.ts`:

```ts
import { z } from 'zod';
import { and, count, desc, eq, gt } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations, messages, consents, system_prompts } from '../db/schema';

export const CHANNELS = ['email', 'sms', 'whatsapp', 'voice', 'linkedin'] as const;
export type Channel = (typeof CHANNELS)[number];

export const MessageLogSchema = z.strictObject({
  org_id: z.uuid(),
  candidate_id: z.uuid(),
  channel: z.enum(CHANNELS),
  direction: z.enum(['inbound', 'outbound']),
  body: z.string().min(1),
  decision_id: z.uuid().nullable().default(null),
});

export async function logMessage(input: unknown): Promise<{ conversation_id: string; message_id: string }> {
  const p = MessageLogSchema.parse(input);
  let [conv] = await db.select().from(conversations).where(and(
    eq(conversations.org_id, p.org_id),
    eq(conversations.candidate_id, p.candidate_id),
    eq(conversations.channel, p.channel),
  ));
  if (!conv) {
    [conv] = await db.insert(conversations)
      .values({ org_id: p.org_id, candidate_id: p.candidate_id, channel: p.channel })
      .returning();
  }
  const [msg] = await db.insert(messages).values({
    org_id: p.org_id, conversation_id: conv.id,
    direction: p.direction, body: p.body, decision_id: p.decision_id,
  }).returning();
  return { conversation_id: conv.id, message_id: msg.id };
}

export async function countRecentOutbound(
  orgId: string, candidateId: string, channel: Channel, days = 7,
): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select({ n: count() }).from(messages)
    .innerJoin(conversations, eq(messages.conversation_id, conversations.id))
    .where(and(
      eq(messages.org_id, orgId),
      eq(conversations.candidate_id, candidateId),
      eq(conversations.channel, channel),
      eq(messages.direction, 'outbound'),
      gt(messages.sent_at, since),
    ));
  return Number(rows[0]?.n ?? 0);
}

export async function getConsentStatus(
  orgId: string, candidateId: string, channel: Channel,
): Promise<'granted' | 'revoked' | 'unknown'> {
  const [row] = await db.select().from(consents).where(and(
    eq(consents.org_id, orgId),
    eq(consents.candidate_id, candidateId),
    eq(consents.channel, channel),
  ));
  return (row?.status as 'granted' | 'revoked' | undefined) ?? 'unknown';
}

export type SystemPromptRow = typeof system_prompts.$inferSelect;

export async function getActivePrompt(
  orgId: string, agent: string, name: string,
): Promise<SystemPromptRow | null> {
  const [row] = await db.select().from(system_prompts)
    .where(and(
      eq(system_prompts.org_id, orgId),
      eq(system_prompts.agent, agent),
      eq(system_prompts.name, name),
      eq(system_prompts.active, true),
    ))
    .orderBy(desc(system_prompts.created_at))
    .limit(1);
  return row ?? null;
}
```

Run: `npm test -- src/services/comms-log.test.ts` → PASS (4 tests).

- [ ] **Step 3: Routes**

Create `src/app/api/agent/messages/route.ts`:

```ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { logMessage } from '../../../../services/comms-log';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    return Response.json(await logMessage(await req.json()), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

Create `src/app/api/agent/consents/route.ts`:

```ts
import { requireAgentKey } from '../../../../lib/agent-auth';
import { getConsentStatus, CHANNELS, type Channel } from '../../../../services/comms-log';

export async function GET(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const orgId = url.searchParams.get('org_id');
  const candidateId = url.searchParams.get('candidate_id');
  const channel = url.searchParams.get('channel') as Channel | null;
  if (!orgId || !candidateId || !channel || !CHANNELS.includes(channel)) {
    return Response.json({ error: 'org_id, candidate_id, channel required' }, { status: 400 });
  }
  return Response.json({ status: await getConsentStatus(orgId, candidateId, channel) });
}
```

Create `src/app/api/agent/prompts/route.ts`:

```ts
import { requireAgentKey } from '../../../../lib/agent-auth';
import { getActivePrompt } from '../../../../services/comms-log';

export async function GET(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const orgId = url.searchParams.get('org_id');
  const agent = url.searchParams.get('agent');
  const name = url.searchParams.get('name');
  if (!orgId || !agent || !name) {
    return Response.json({ error: 'org_id, agent, name required' }, { status: 400 });
  }
  const prompt = await getActivePrompt(orgId, agent, name);
  if (!prompt) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ prompt });
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add -A
git commit -m "feat: comms logging, consent, and prompt read APIs"
```

---

### Task 3: Compliance gate

**Files:**
- Create: `src/services/compliance.ts`, `src/app/api/agent/compliance/check/route.ts`
- Test: `src/services/compliance.test.ts` (the spec requires the gate to have its own suite)

**Interfaces:**
- Consumes: `getConsentStatus`, `countRecentOutbound`, `CHANNELS` from Task 2.
- Produces:
  - `checkCompliance(input: unknown, now?: Date): Promise<{ verdict: 'allow' | 'defer' | 'deny'; reasons: string[] }>` — input `{ org_id, candidate_id, channel }`.
  - Rules: consent `revoked` → **deny** `['consent_revoked']` (short-circuits); outside 08:00–20:00 `America/New_York` → **defer** `quiet_hours`; ≥ 2 outbound in 7 days → **defer** `frequency_cap`; else **allow**.
  - `QUIET_HOURS`, `FREQUENCY_CAP` exported consts (per-org config is a later phase).
  - HTTP: `POST /api/agent/compliance/check` → 200 `{ verdict, reasons }`.

- [ ] **Step 1: Write the failing gate suite**

Create `src/services/compliance.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { checkCompliance } from './compliance';
import { logMessage } from './comms-log';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;

// 2026-07-09 is EDT (UTC-4): 18:00Z = 2pm local (inside window), 07:00Z = 3am local (quiet).
const DAYTIME = new Date('2026-07-09T18:00:00Z');
const NIGHT = new Date('2026-07-09T07:00:00Z');

async function makeCandidate(): Promise<string> {
  return (await sql`
    insert into candidates (org_id, full_name, email)
    values (${orgId}, 'Gate Test', ${'gate-' + Date.now() + Math.random() + '@example.com'}) returning id`)[0].id;
}

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

describe('checkCompliance', () => {
  it('allows a clean candidate during the day', async () => {
    const c = await makeCandidate();
    expect(await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, DAYTIME))
      .toEqual({ verdict: 'allow', reasons: [] });
  });

  it('denies on revoked consent regardless of time', async () => {
    const c = await makeCandidate();
    await sql`insert into consents (org_id, candidate_id, channel, status) values (${orgId}, ${c}, 'email', 'revoked')`;
    expect(await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, NIGHT))
      .toEqual({ verdict: 'deny', reasons: ['consent_revoked'] });
  });

  it('defers during quiet hours', async () => {
    const c = await makeCandidate();
    const r = await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, NIGHT);
    expect(r.verdict).toBe('defer');
    expect(r.reasons).toContain('quiet_hours');
  });

  it('defers on the frequency cap after 2 outbound touches this week', async () => {
    const c = await makeCandidate();
    for (const body of ['touch 1', 'touch 2']) {
      await logMessage({ org_id: orgId, candidate_id: c, channel: 'email', direction: 'outbound', body, decision_id: null });
    }
    const r = await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, DAYTIME);
    expect(r.verdict).toBe('defer');
    expect(r.reasons).toContain('frequency_cap');
  });

  it('granted consent does not defeat quiet hours', async () => {
    const c = await makeCandidate();
    await sql`insert into consents (org_id, candidate_id, channel, status) values (${orgId}, ${c}, 'email', 'granted')`;
    const r = await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, NIGHT);
    expect(r.verdict).toBe('defer');
  });
});
```

Run: `npm test -- src/services/compliance.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the gate**

Create `src/services/compliance.ts`:

```ts
import { z } from 'zod';
import { CHANNELS, countRecentOutbound, getConsentStatus } from './comms-log';

// Per-org configuration is a later phase; one org today (spec: own agency first).
export const QUIET_HOURS = { tz: 'America/New_York', startHour: 8, endHour: 20 } as const;
export const FREQUENCY_CAP = { maxOutbound: 2, windowDays: 7 } as const;

export type ComplianceVerdict = 'allow' | 'defer' | 'deny';

export const ComplianceInputSchema = z.strictObject({
  org_id: z.uuid(),
  candidate_id: z.uuid(),
  channel: z.enum(CHANNELS),
});

export function localHour(now: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now));
}

export async function checkCompliance(
  input: unknown,
  now: Date = new Date(),
): Promise<{ verdict: ComplianceVerdict; reasons: string[] }> {
  const p = ComplianceInputSchema.parse(input);

  if ((await getConsentStatus(p.org_id, p.candidate_id, p.channel)) === 'revoked') {
    return { verdict: 'deny', reasons: ['consent_revoked'] };
  }

  const reasons: string[] = [];
  const hour = localHour(now, QUIET_HOURS.tz);
  if (hour < QUIET_HOURS.startHour || hour >= QUIET_HOURS.endHour) reasons.push('quiet_hours');
  if ((await countRecentOutbound(p.org_id, p.candidate_id, p.channel, FREQUENCY_CAP.windowDays)) >= FREQUENCY_CAP.maxOutbound) {
    reasons.push('frequency_cap');
  }
  return { verdict: reasons.length > 0 ? 'defer' : 'allow', reasons };
}
```

Create `src/app/api/agent/compliance/check/route.ts`:

```ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { checkCompliance } from '../../../../../services/compliance';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    return Response.json(await checkCompliance(await req.json()));
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm test -- src/services/compliance.test.ts
npm test
git add -A
git commit -m "feat: compliance gate — consent deny, quiet-hours and frequency-cap defer"
```

Expected: gate suite PASS (5 tests), full suite PASS.

---

### Task 4: Data Steward APIs — candidate ingest (dedupe) and embeddings upsert

**Files:**
- Create: `src/services/ingest.ts`, `src/app/api/agent/candidates/route.ts`, `src/app/api/agent/embeddings/route.ts`
- Test: `src/services/ingest.test.ts`

**Interfaces:**
- Consumes: `candidates`, `candidate_documents`, `embeddings` tables.
- Produces:
  - `ingestCandidate(input: unknown): Promise<{ candidate_id: string; document_id: string | null; deduped: boolean }>` — dedupe by lower(email), then exact phone, within org. On match: keep existing identity fields (email/phone), prefer incoming profile fields (title/location); `resume_text` becomes a new `candidate_documents` row at `max(version)+1`. Runs inside a transaction holding a `pg_advisory_xact_lock` keyed on `org_id + identity` (email, falling back to phone) — the dedupe match is email-OR-phone, not a single column, so a DB unique constraint can't enforce it directly; without the lock, two concurrent ingests for the same person (plausible the moment Plan 1d's JobDiva migration does bulk/parallel import) can both see "no match" and both insert, silently defeating the one thing this function is for. `CandidateIngestSchema` exported.
  - `upsertEmbeddings(input: unknown): Promise<{ inserted: number }>` — delete-then-insert per `(org_id, subject_type, subject_id)`; chunks validated at exactly 3072 dims. `subject_type` is `'candidate_document' | 'job_order'` — matches the corrected schema comment in `src/db/schema/intelligence.ts`. `EmbeddingsUpsertSchema` exported.
  - HTTP: `POST /api/agent/candidates` → 201; `POST /api/agent/embeddings` → 201; both 400 with Zod issues.

- [ ] **Step 1: Write failing tests**

Create `src/services/ingest.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { ingestCandidate, upsertEmbeddings } from './ingest';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
const email = `ingest-${Date.now()}@example.com`;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

const vec = () => { const v = new Array(3072).fill(0); v[0] = 1; return v; };

describe('ingestCandidate', () => {
  it('creates a new candidate with a v1 resume document', async () => {
    const r = await ingestCandidate({
      org_id: orgId, full_name: 'Ingest One', email,
      current_title: 'React Developer', resume_text: 'resume v1 text',
    });
    expect(r.deduped).toBe(false);
    expect(r.document_id).not.toBeNull();
  });

  it('dedupes on email, fills phone, bumps the document version', async () => {
    const r = await ingestCandidate({
      org_id: orgId, full_name: 'Ingest One', email: email.toUpperCase(),
      phone: '+15550001111', resume_text: 'resume v2 text',
    });
    expect(r.deduped).toBe(true);
    const [doc] = await sql`
      select version from candidate_documents where id = ${r.document_id} `;
    expect(doc.version).toBe(2);
    const [cand] = await sql`select phone from candidates where id = ${r.candidate_id}`;
    expect(cand.phone).toBe('+15550001111');
  });

  it('serializes concurrent ingests for the same identity — no duplicate candidates', async () => {
    const raceEmail = `race-${Date.now()}@example.com`;
    const [a, b] = await Promise.all([
      ingestCandidate({ org_id: orgId, full_name: 'Race One', email: raceEmail }),
      ingestCandidate({ org_id: orgId, full_name: 'Race Two', email: raceEmail }),
    ]);
    expect(a.candidate_id).toBe(b.candidate_id);
    const [{ n }] = await sql`select count(*)::int as n from candidates where lower(email) = lower(${raceEmail})`;
    expect(n).toBe(1);
  });
});

describe('upsertEmbeddings', () => {
  it('replaces prior chunks for the subject (refresh semantics)', async () => {
    const { document_id } = await ingestCandidate({
      org_id: orgId, full_name: 'Embed Target',
      email: `embed-${Date.now()}@example.com`, resume_text: 'text',
    });
    const chunk = { chunk_index: 0, content: 'text', embedding: vec(), content_hash: 'h1' };
    await upsertEmbeddings({ org_id: orgId, subject_type: 'candidate_document', subject_id: document_id, chunks: [chunk] });
    await upsertEmbeddings({ org_id: orgId, subject_type: 'candidate_document', subject_id: document_id, chunks: [chunk, { ...chunk, chunk_index: 1, content_hash: 'h2' }] });
    const [{ n }] = await sql`select count(*)::int as n from embeddings where subject_id = ${document_id}`;
    expect(n).toBe(2);
  });

  it('rejects wrong dimensionality', async () => {
    await expect(upsertEmbeddings({
      org_id: orgId, subject_type: 'candidate_document',
      subject_id: '00000000-0000-7000-8000-000000000001',
      chunks: [{ chunk_index: 0, content: 'x', embedding: [1, 2, 3], content_hash: 'h' }],
    })).rejects.toThrow();
  });
});
```

Run: `npm test -- src/services/ingest.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the service**

Create `src/services/ingest.ts`:

```ts
import { z } from 'zod';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates, candidate_documents, embeddings } from '../db/schema';

export const CandidateIngestSchema = z.strictObject({
  org_id: z.uuid(),
  full_name: z.string().min(1),
  email: z.email().nullable().default(null),
  phone: z.string().nullable().default(null),
  current_title: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  resume_text: z.string().nullable().default(null),
});

export async function ingestCandidate(input: unknown): Promise<{
  candidate_id: string; document_id: string | null; deduped: boolean;
}> {
  const p = CandidateIngestSchema.parse(input);

  // The dedupe match is email-OR-phone, not one column, so a DB unique constraint can't
  // enforce it directly. Serialize concurrent ingests for the same identity with an
  // advisory lock (released automatically at transaction end) instead — without it, two
  // concurrent calls for the same person can both see "no match" and both insert.
  return db.transaction(async (tx) => {
    const lockKey = `${p.org_id}|${(p.email ?? p.phone ?? '').toLowerCase()}`;
    await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    let existing: typeof candidates.$inferSelect | undefined;
    if (p.email) {
      [existing] = await tx.select().from(candidates).where(and(
        eq(candidates.org_id, p.org_id),
        dsql`lower(${candidates.email}) = lower(${p.email})`,
      ));
    }
    if (!existing && p.phone) {
      [existing] = await tx.select().from(candidates).where(and(
        eq(candidates.org_id, p.org_id), eq(candidates.phone, p.phone),
      ));
    }

    let candidateId: string;
    const deduped = !!existing;
    if (existing) {
      candidateId = existing.id;
      // Identity fields keep the existing value; profile fields prefer the fresher incoming value.
      await tx.update(candidates).set({
        email: existing.email ?? p.email,
        phone: existing.phone ?? p.phone,
        current_title: p.current_title ?? existing.current_title,
        location: p.location ?? existing.location,
        source: existing.source ?? p.source,
      }).where(eq(candidates.id, existing.id));
    } else {
      const [row] = await tx.insert(candidates).values({
        org_id: p.org_id, full_name: p.full_name, email: p.email, phone: p.phone,
        current_title: p.current_title, location: p.location, source: p.source,
      }).returning();
      candidateId = row.id;
    }

    let documentId: string | null = null;
    if (p.resume_text) {
      const [{ maxV }] = await tx
        .select({ maxV: dsql<number>`coalesce(max(${candidate_documents.version}), 0)` })
        .from(candidate_documents)
        .where(eq(candidate_documents.candidate_id, candidateId));
      const version = Number(maxV) + 1;
      const [doc] = await tx.insert(candidate_documents).values({
        org_id: p.org_id, candidate_id: candidateId, kind: 'resume',
        storage_key: `ingest/${candidateId}/v${version}.txt`,
        parsed_text: p.resume_text, version,
      }).returning();
      documentId = doc.id;
    }

    return { candidate_id: candidateId, document_id: documentId, deduped };
  });
}

export const EmbeddingsUpsertSchema = z.strictObject({
  org_id: z.uuid(),
  subject_type: z.enum(['candidate_document', 'job_order']),
  subject_id: z.uuid(),
  chunks: z.array(z.strictObject({
    chunk_index: z.number().int().min(0),
    content: z.string().min(1),
    embedding: z.array(z.number()).length(3072),
    content_hash: z.string().min(1),
  })).min(1),
});

export async function upsertEmbeddings(input: unknown): Promise<{ inserted: number }> {
  const p = EmbeddingsUpsertSchema.parse(input);
  await db.delete(embeddings).where(and(
    eq(embeddings.org_id, p.org_id),
    eq(embeddings.subject_type, p.subject_type),
    eq(embeddings.subject_id, p.subject_id),
  ));
  await db.insert(embeddings).values(p.chunks.map((c) => ({
    org_id: p.org_id, subject_type: p.subject_type, subject_id: p.subject_id,
    chunk_index: c.chunk_index, content: c.content,
    embedding: c.embedding, content_hash: c.content_hash,
  })));
  return { inserted: p.chunks.length };
}
```

Run: `npm test -- src/services/ingest.test.ts` → PASS (5 tests).

- [ ] **Step 3: Routes**

Create `src/app/api/agent/candidates/route.ts`:

```ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { ingestCandidate } from '../../../../services/ingest';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    return Response.json(await ingestCandidate(await req.json()), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

Create `src/app/api/agent/embeddings/route.ts`:

```ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { upsertEmbeddings } from '../../../../services/ingest';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    return Response.json(await upsertEmbeddings(await req.json()), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add -A
git commit -m "feat: data steward APIs — dedupe ingest and 3072-dim embeddings upsert"
```

---

### Task 5: Matching APIs — vector search, job order, candidate+resume, scores

**Files:**
- Create: `src/services/matching.ts`, `src/app/api/agent/search/candidates/route.ts`, `src/app/api/agent/job-orders/[id]/route.ts`, `src/app/api/agent/candidates/[id]/route.ts`, `src/app/api/agent/scores/route.ts`
- Test: `src/services/matching.test.ts`

**Interfaces:**
- Consumes: `ingestCandidate`, `upsertEmbeddings` (test fixtures); `embeddings`, `candidates`, `candidate_documents`, `job_orders`, `scores` tables.
- Produces:
  - `searchCandidatesByEmbedding(orgId, queryEmbedding: number[], limit = 10): Promise<Array<{ candidate_id, full_name, current_title, distance: number }>>` — best cosine distance per candidate over their document chunks, ascending.
  - `getJobOrder(orgId, id): Promise<JobOrderRow | null>`.
  - `getCandidateWithResume(orgId, id): Promise<{ candidate, resume: { document_id, parsed_text } | null } | null>` (latest version).
  - `insertScore(input: unknown): Promise<ScoreRow>` with `ScoreInsertSchema` — `fit_rating ∈ {yes,borderline,no}`, `weighted_score` 0–1 nullable, `criteria` jsonb.
  - HTTP: `POST /api/agent/search/candidates` `{ org_id, query_embedding[3072], limit? }` → `{ results }`; `GET /api/agent/job-orders/:id?org_id=` → `{ job_order }` | 404; `GET /api/agent/candidates/:id?org_id=` → `{ candidate, resume }` | 404; `POST /api/agent/scores` → 201 `{ score }`.

- [ ] **Step 1: Write failing tests**

Create `src/services/matching.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { ingestCandidate, upsertEmbeddings } from './ingest';
import { searchCandidatesByEmbedding, getJobOrder, getCandidateWithResume, insertScore } from './matching';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
let near: { candidate_id: string; document_id: string | null };
let far: { candidate_id: string; document_id: string | null };
let jobId: string;

const axis = (i: number) => { const v = new Array(3072).fill(0); v[i] = 1; return v; };

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  const tag = Date.now();
  near = await ingestCandidate({ org_id: orgId, full_name: 'Near Match', email: `near-${tag}@example.com`, resume_text: 'react expert' });
  far = await ingestCandidate({ org_id: orgId, full_name: 'Far Match', email: `far-${tag}@example.com`, resume_text: 'accountant' });
  await upsertEmbeddings({ org_id: orgId, subject_type: 'candidate_document', subject_id: near.document_id, chunks: [{ chunk_index: 0, content: 'react expert', embedding: axis(0), content_hash: 'n' }] });
  await upsertEmbeddings({ org_id: orgId, subject_type: 'candidate_document', subject_id: far.document_id, chunks: [{ chunk_index: 0, content: 'accountant', embedding: axis(1), content_hash: 'f' }] });
  jobId = (await sql`
    insert into job_orders (org_id, title, description, kind, must_haves)
    values (${orgId}, 'Matching Test Job', 'React work', 'contract', '["React"]'::jsonb) returning id`)[0].id;
});

describe('searchCandidatesByEmbedding', () => {
  it('ranks the axis-aligned candidate first with ~0 distance', async () => {
    const results = await searchCandidatesByEmbedding(orgId, axis(0), 5);
    const nearHit = results.find((r) => r.candidate_id === near.candidate_id);
    const farHit = results.find((r) => r.candidate_id === far.candidate_id);
    expect(nearHit).toBeDefined();
    expect(nearHit!.distance).toBeLessThan(0.01);
    if (farHit) expect(farHit.distance).toBeGreaterThan(0.9);
    expect(results[0].candidate_id).toBe(near.candidate_id);
  });
});

describe('getJobOrder / getCandidateWithResume', () => {
  it('fetches the job order in-org, null cross-org', async () => {
    expect((await getJobOrder(orgId, jobId))?.title).toBe('Matching Test Job');
    expect(await getJobOrder('00000000-0000-7000-8000-000000000000', jobId)).toBeNull();
  });

  it('returns candidate with latest resume text', async () => {
    const r = await getCandidateWithResume(orgId, near.candidate_id);
    expect(r?.candidate.full_name).toBe('Near Match');
    expect(r?.resume?.parsed_text).toBe('react expert');
  });
});

describe('insertScore', () => {
  it('persists a score row with criteria breakdown', async () => {
    const s = await insertScore({
      org_id: orgId, job_order_id: jobId, candidate_id: near.candidate_id,
      prompt_version: 'v2.2.0', model: 'gemini-2.5-flash',
      fit_rating: 'yes', weighted_score: 0.87, criteria: { C01: { score: 5 } },
    });
    expect(s.id).toBeTruthy();
    expect(s.fit_rating).toBe('yes');
  });

  it('rejects an invalid fit_rating', async () => {
    await expect(insertScore({
      org_id: orgId, job_order_id: jobId, candidate_id: near.candidate_id,
      prompt_version: 'v', model: 'm', fit_rating: 'maybe',
    })).rejects.toThrow();
  });
});
```

Run: `npm test -- src/services/matching.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the service**

Create `src/services/matching.ts`:

```ts
import { z } from 'zod';
import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates, candidate_documents, job_orders, scores } from '../db/schema';

export async function searchCandidatesByEmbedding(
  orgId: string, queryEmbedding: number[], limit = 10,
): Promise<Array<{ candidate_id: string; full_name: string; current_title: string | null; distance: number }>> {
  const vec = `[${queryEmbedding.join(',')}]`;
  const rows = await db.execute(dsql`
    select c.id as candidate_id, c.full_name, c.current_title,
           min(e.embedding <=> ${vec}::halfvec(3072)) as distance
    from embeddings e
    join candidate_documents d on d.id = e.subject_id
    join candidates c on c.id = d.candidate_id
    where e.org_id = ${orgId} and e.subject_type = 'candidate_document'
    group by c.id, c.full_name, c.current_title
    order by distance asc
    limit ${limit}`);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    candidate_id: r.candidate_id as string,
    full_name: r.full_name as string,
    current_title: (r.current_title as string) ?? null,
    distance: Number(r.distance),
  }));
}

export type JobOrderRow = typeof job_orders.$inferSelect;

export async function getJobOrder(orgId: string, id: string): Promise<JobOrderRow | null> {
  const [row] = await db.select().from(job_orders)
    .where(and(eq(job_orders.org_id, orgId), eq(job_orders.id, id)));
  return row ?? null;
}

export async function getCandidateWithResume(orgId: string, id: string) {
  const [cand] = await db.select().from(candidates)
    .where(and(eq(candidates.org_id, orgId), eq(candidates.id, id)));
  if (!cand) return null;
  const [doc] = await db.select().from(candidate_documents)
    .where(and(eq(candidate_documents.org_id, orgId), eq(candidate_documents.candidate_id, id)))
    .orderBy(desc(candidate_documents.version))
    .limit(1);
  return {
    candidate: cand,
    resume: doc ? { document_id: doc.id, parsed_text: doc.parsed_text } : null,
  };
}

export const ScoreInsertSchema = z.strictObject({
  org_id: z.uuid(),
  job_order_id: z.uuid(),
  candidate_id: z.uuid(),
  prompt_version: z.string().min(1),
  model: z.string().min(1),
  fit_rating: z.enum(['yes', 'borderline', 'no']),
  weighted_score: z.number().min(0).max(1).nullable().default(null),
  criteria: z.record(z.string(), z.unknown()).default({}),
});

export type ScoreRow = typeof scores.$inferSelect;

export async function insertScore(input: unknown): Promise<ScoreRow> {
  const p = ScoreInsertSchema.parse(input);
  const [row] = await db.insert(scores).values({
    ...p, weighted_score: p.weighted_score === null ? null : String(p.weighted_score),
  }).returning();
  return row;
}
```

(Drizzle `numeric` columns take strings — hence the `String(...)` on insert. If the installed drizzle-orm accepts numbers for `numeric`, keep the string form anyway; it round-trips exactly.)

Run: `npm test -- src/services/matching.test.ts` → PASS (5 tests).

- [ ] **Step 3: Routes**

Create `src/app/api/agent/search/candidates/route.ts`:

```ts
import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { searchCandidatesByEmbedding } from '../../../../../services/matching';

const SearchSchema = z.strictObject({
  org_id: z.uuid(),
  query_embedding: z.array(z.number()).length(3072),
  limit: z.number().int().min(1).max(100).default(10),
});

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    const p = SearchSchema.parse(await req.json());
    const results = await searchCandidatesByEmbedding(p.org_id, p.query_embedding, p.limit);
    return Response.json({ results });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

Create `src/app/api/agent/job-orders/[id]/route.ts`:

```ts
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { getJobOrder } from '../../../../../services/matching';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const orgId = new URL(req.url).searchParams.get('org_id');
  if (!orgId) return Response.json({ error: 'org_id required' }, { status: 400 });
  const { id } = await ctx.params;
  const job_order = await getJobOrder(orgId, id);
  if (!job_order) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ job_order });
}
```

Create `src/app/api/agent/candidates/[id]/route.ts`:

```ts
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { getCandidateWithResume } from '../../../../../services/matching';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const orgId = new URL(req.url).searchParams.get('org_id');
  if (!orgId) return Response.json({ error: 'org_id required' }, { status: 400 });
  const { id } = await ctx.params;
  const result = await getCandidateWithResume(orgId, id);
  if (!result) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json(result);
}
```

Create `src/app/api/agent/scores/route.ts`:

```ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { insertScore } from '../../../../services/matching';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    return Response.json({ score: await insertScore(await req.json()) }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify and commit**

```bash
npm test
git add -A
git commit -m "feat: matching APIs — halfvec search, job/candidate reads, score writes"
```

---

### Task 6: Scorer assets port — prompts snapshot, parse + C01 gate, seed

**Files:**
- Create: `n8n/prompts/scorer-prompts-snapshot_2026-07-09.json` (copied), `n8n/lib/parse-score-output.js`
- Modify: `src/db/seed.ts` (prompt upsert), `vitest.config.ts` (include `n8n/**`)
- Test: `n8n/lib/parse-score-output.test.ts`

**Interfaces:**
- Consumes: hub snapshot + restored parse code (paths in the header).
- Produces:
  - `parseScoreOutput(raw: object)` (CommonJS export) → `{ scores, weighted_score (0–5), fit_percentage, fit_rating ('Excellent Fit'|'Good Fit'|'Moderate Fit'|'Poor Fit'), agent_label ('yes'|'borderline'|'no'), c01_gate_fired, gate_version: 'C01-hard-gate-v2', top_strengths, key_gaps, recommendation, submittal_ready }`. Task 11 inlines this file into the Screening Code node.
  - Seed rows: `system_prompts` (agent `screening`, name `resume-scorer`, versions `v2.2.0` **active** + `v2.3.0` inactive, body = `{system, user_template}` JSON string).

- [ ] **Step 1: Copy the snapshot into the repo**

```bash
mkdir -p n8n/prompts n8n/lib
cp "/Users/richardlove/Desktop/Projects/Claude/Agentic_Recruiting/04-scoring-calibration/scorer-prompts-snapshot_2026-07-09.json" \
   n8n/prompts/scorer-prompts-snapshot_2026-07-09.json
```

- [ ] **Step 2: Failing parse tests**

Update `vitest.config.ts` include to:

```ts
    include: ['src/**/*.test.{ts,tsx}', 'n8n/**/*.test.ts'],
```

Create `n8n/lib/parse-score-output.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { parseScoreOutput } from './parse-score-output.js';

const IDS = ['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12'];

function geminiResponse(scoresById: Record<string, number>) {
  const scored_criteria = IDS.map((id) => ({ id, score: scoresById[id] ?? 4, rationale: 'evidence' }));
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      evaluation: { scored_criteria, summary: { top_strengths: ['s1'], key_gaps: ['g1'], recommendation: 'rec' } },
    }) }] } }],
    modelVersion: 'gemini-2.5-flash',
  };
}

describe('parseScoreOutput', () => {
  it('computes weighted score, percentage, and labels (all 4s → 80% → yes)', () => {
    const r = parseScoreOutput(geminiResponse({}));
    expect(r.weighted_score).toBeCloseTo(4.0, 3);
    expect(r.fit_percentage).toBe(80);
    expect(r.agent_label).toBe('yes');
    expect(r.fit_rating).toBe('Good Fit');
    expect(r.submittal_ready).toBe(true);
    expect(r.c01_gate_fired).toBe(false);
  });

  it('fires the C01 hard gate: C01=1 forces no despite a high total', () => {
    const all5s = Object.fromEntries(IDS.map((id) => [id, 5]));
    const r = parseScoreOutput(geminiResponse({ ...all5s, C01: 1 }));
    expect(r.c01_gate_fired).toBe(true);
    expect(r.agent_label).toBe('no');
    expect(r.submittal_ready).toBe(false);
    expect(r.fit_percentage).toBeGreaterThan(80); // numeric preserved for diagnosis
  });

  it('borderline band: ~60% → borderline', () => {
    const all3s = Object.fromEntries(IDS.map((id) => [id, 3]));
    const r = parseScoreOutput(geminiResponse(all3s));
    expect(r.fit_percentage).toBe(60);
    expect(r.agent_label).toBe('borderline');
  });

  it('throws when no model text can be located', () => {
    expect(() => parseScoreOutput({ nope: true })).toThrow(/could not locate/);
  });
});
```

Run: `npm test -- n8n/lib/parse-score-output.test.ts` → FAIL (module missing).

- [ ] **Step 3: Port the parse code**

Create `n8n/lib/parse-score-output.js` — this is the validated v2.2.0 parse + C01-hard-gate-v2 from
`Agentic_Recruiting/03-workflows-n8n/slice05-parse-score-output-restored.js`, reshaped as a pure function
(the n8n-specific `$('Prepare Scoring Input')` threading is dropped; callers own that context now):

```js
// Ported from the validated Agentic_Recruiter_Match "Parse Score Output" node
// (score-v2.2.0 + C01-hard-gate-v2, ADR-0002 / CAL-0002 baseline 81.3%).
// Pure function: takes the raw Gemini response object, returns the parsed evaluation.
// Inlined into the n8n Screening Code node by n8n/build.mjs — keep it dependency-free.

const WEIGHTS = { C01: 0.15, C02: 0.15, C03: 0.10, C04: 0.10, C05: 0.10, C06: 0.05,
                  C07: 0.05, C08: 0.08, C09: 0.05, C10: 0.05, C11: 0.07, C12: 0.05 };

function parseScoreOutput(raw) {
  // Locate the model's JSON text robustly across node/output shapes.
  const text =
       raw?.candidates?.[0]?.content?.parts?.[0]?.text  // raw REST shape
    ?? raw?.content?.parts?.[0]?.text                   // langchain googleGemini (simplify:false)
    ?? raw?.text                                        // simplified
    ?? (typeof raw?.content === 'string' ? raw.content : null);
  if (!text) {
    throw new Error('parseScoreOutput: could not locate Gemini JSON text in the response');
  }
  const evaluation = JSON.parse(text).evaluation;

  // Model returns either a scored_criteria[] array or a scores{} object — handle both.
  let criteriaArray = [];
  if (Array.isArray(evaluation.scored_criteria)) {
    criteriaArray = evaluation.scored_criteria;
  } else if (evaluation.scores) {
    criteriaArray = Object.entries(evaluation.scores).map(([k, v]) => ({
      id: k.substring(0, 3).toUpperCase(), score: v.score, rationale: v.rationale }));
  }

  const scores = {};
  let weightedScore = 0;
  criteriaArray.forEach((c) => {
    const id = c.id.toUpperCase();
    const w = WEIGHTS[id] || 0;
    scores[id] = { score: c.score, rationale: c.rationale };
    weightedScore += c.score * w;
  });

  const fitPct = parseFloat(((weightedScore / 5.0) * 100).toFixed(1));

  let fitRating =
    fitPct >= 85 ? 'Excellent Fit' :
    fitPct >= 70 ? 'Good Fit' :
    fitPct >= 55 ? 'Moderate Fit' : 'Poor Fit';
  let submittalReady = fitPct >= 70;
  let agentLabel = fitPct >= 70 ? 'yes' : fitPct >= 55 ? 'borderline' : 'no';

  // C01 hard gate :: ADR-0002 (score-v2.2.0 + C01-hard-gate-v2). If Primary Role Keywords
  // Match <= 1, force 'no' regardless of the weighted total. Numeric preserved for diagnosis.
  const c01 = scores.C01 ? scores.C01.score : null;
  const gateFired = c01 !== null && c01 <= 1;
  if (gateFired) {
    fitRating = 'Poor Fit';
    submittalReady = false;
    agentLabel = 'no';
  }

  return {
    scores,
    weighted_score: parseFloat(weightedScore.toFixed(3)),
    fit_percentage: fitPct,
    fit_rating: fitRating,
    agent_label: agentLabel,
    c01_gate_fired: gateFired,
    gate_version: 'C01-hard-gate-v2',
    top_strengths: evaluation.summary?.top_strengths || [],
    key_gaps: evaluation.summary?.key_gaps || [],
    recommendation: evaluation.summary?.recommendation || '',
    submittal_ready: submittalReady,
  };
}

module.exports = { parseScoreOutput, WEIGHTS };
```

Run: `npm test -- n8n/lib/parse-score-output.test.ts` → PASS (4 tests).

- [ ] **Step 4: Seed the prompts (idempotent)**

In `src/db/seed.ts`, add `import { readFileSync } from 'node:fs';` at the top and insert before the final log lines:

```ts
  const snapshot = JSON.parse(
    readFileSync('n8n/prompts/scorer-prompts-snapshot_2026-07-09.json', 'utf8'),
  ) as { prompts: Array<{ id: string; prompt: { system: string; user_template: string } }> };
  for (const p of snapshot.prompts) {
    const version = p.id.replace('score-', ''); // 'v2.2.0' | 'v2.3.0'
    await sql`
      insert into system_prompts (org_id, agent, name, version, body, active)
      values (${orgId}, 'screening', 'resume-scorer', ${version},
              ${JSON.stringify(p.prompt)}, ${version === 'v2.2.0'})
      on conflict (org_id, agent, name, version) do nothing`;
  }
```

(v2.2.0 active per the spec's "v1 brain"; v2.3.0 seeded inactive — its grounded C11 needs structured pay
fields that arrive with the Plan 1d migration. See CAL-0003.)

Run twice and verify:

```bash
npm run db:seed
npm run db:seed
docker compose exec db psql -U agency -tA -c \
  "select version, active from system_prompts where name='resume-scorer' order by version"
```

Expected: `v2.2.0|t` and `v2.3.0|f`, exactly one row each after both runs.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: port calibrated scorer assets — prompts v2.2.0/v2.3.0, parse + C01 hard gate"
```

---

### Task 7: n8n + Mailpit infrastructure and the workflow build pipeline

**Files:**
- Modify: `docker-compose.yml`, `.env`, `.env.example`, `.gitignore`
- Create: `n8n/build.mjs`, `n8n/apply.sh`, `n8n/workflows/src/lib.mjs`, `n8n/workflows/src/helpers.js`, `n8n/workflows/src/heartbeat.workflow.mjs`, `n8n/tests/lib.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure infra).
- Produces:
  - Running `n8n` (port 5678) and `mailpit` (port 8025) containers with env: `AGENCY_API_URL`, `AGENT_API_KEY`, `GEMINI_API_KEY`, `MAIL_API_URL`, `MAIL_FROM`.
  - Builders from `lib.mjs`: `webhook(name, path)`, `schedule(name, minutes)`, `code(name, agent, jsCode, { withParser? })`, `workflow(wfId, name, nodes)` — linear chains; Code nodes get `helpers.js` (and optionally the parse lib) prepended.
  - Code-node helper globals (from `helpers.js`): `http(opts)`, `apiGet(path, qs)`, `apiPost(path, body)`, `embed(text) → number[3072]`, `generateJson(model, system, user, temperature?)`, `proposeDecision(p)`, `transition(id, to, extras?)`, `completeDecision(id, outcome)`, `chunkText(text, size?, overlap?)`, `sha256(s)`, `WORKFLOW_AGENT`.
  - `bash n8n/apply.sh` — build → import → restart; `n8n/tests/lib.sh` — `ORG_ID`, `api_get`, `api_post`, `wait_for`, `$PSQL`.

- [ ] **Step 1: Compose services + env**

Append to `docker-compose.yml` under `services:`:

```yaml
  n8n:
    # Pin to a specific tag, not :latest — this task's inline notes below (Step 3) flag
    # import:workflow/env-access/crypto-builtin behaviors that need verifying against the
    # installed version. Run `docker run --rm n8nio/n8n:latest n8n --version` once and
    # hard-code the returned tag here so a later `docker compose pull` can't silently move it.
    image: n8nio/n8n:<pin-this-at-build-time>
    ports:
      - "5678:5678"
    environment:
      - N8N_ENCRYPTION_KEY=dev-encryption-key-change-me
      - N8N_BLOCK_ENV_ACCESS_IN_NODE=false
      - NODE_FUNCTION_ALLOW_BUILTIN=crypto
      - GENERIC_TIMEZONE=America/New_York
      - AGENCY_API_URL=http://host.docker.internal:3000
      - AGENT_API_KEY=${AGENT_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - MAIL_API_URL=http://mailpit:8025/api/v1/send
      - MAIL_FROM=recruiting@sundayaiwork.dev
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - n8n_data:/home/node/.n8n
      - ./n8n/dist:/workflows:ro
  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "8025:8025"
```

Add `n8n_data:` under `volumes:`. Append `GEMINI_API_KEY=<real key>` to `.env` and
`GEMINI_API_KEY=your-gemini-api-key` to `.env.example`. Append `n8n/dist/` to `.gitignore`.
`AGENT_API_KEY` is already present in both `.env` and `.env.example` from Plan 1a — no change
needed there, it now flows into the n8n container by interpolation instead of a hardcoded literal.

```bash
docker compose up -d
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5678/healthz   # expect 200
curl -s http://localhost:8025/api/v1/messages | head -c 80               # expect JSON
```

(Version notes to verify at build time: Mailpit's `POST /api/v1/send` exists since v1.22; n8n `$env` access requires `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`; `require('crypto')` in Code nodes requires `NODE_FUNCTION_ALLOW_BUILTIN=crypto`.)

- [ ] **Step 2: Code-node helpers**

Create `n8n/workflows/src/helpers.js` — this is a **fragment** prepended to every Code node by the builder
(n8n injects `$env`, `$json`, and `this.helpers` at runtime; the file is not standalone-runnable):

```js
// ---- AgencyOS Code-node helpers (prepended by n8n/build.mjs) ----
// Requires: const WORKFLOW_AGENT = '<agent>'; injected above this block by the builder.
const http = (o) => this.helpers.httpRequest(o);
const API = $env.AGENCY_API_URL;
const HEADERS = { 'x-agent-api-key': $env.AGENT_API_KEY };
const apiGet = (path, qs) => http({ method: 'GET', url: API + path, headers: HEADERS, qs, json: true });
const apiPost = (path, body) => http({ method: 'POST', url: API + path, headers: HEADERS, body, json: true });

const geminiPost = (model, action, body) => http({
  method: 'POST',
  url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`,
  headers: { 'x-goog-api-key': $env.GEMINI_API_KEY },
  body, json: true,
});
const embed = async (text) => (await geminiPost('gemini-embedding-001', 'embedContent', {
  model: 'models/gemini-embedding-001',
  content: { parts: [{ text }] },
  outputDimensionality: 3072,
})).embedding.values;
const generateJson = (model, system, user, temperature = 0.1) => geminiPost(model, 'generateContent', {
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: user }] }],
  generationConfig: { temperature, responseMimeType: 'application/json' },
});

const proposeDecision = (p) => apiPost('/api/agent/decisions', p);
const transition = (id, to, extras = {}) =>
  apiPost(`/api/agent/decisions/${id}/transition`, { to, actor: WORKFLOW_AGENT, ...extras });
const completeDecision = async (id, outcome) => {
  await transition(id, 'executing');
  return transition(id, 'executed', { outcome });
};

const chunkText = (text, size = 1500, overlap = 200) => {
  const out = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
};
const sha256 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
// ---- end helpers ----
```

- [ ] **Step 3: Workflow builders + build script**

Create `n8n/workflows/src/lib.mjs`:

```js
// Declares n8n workflows as data. Linear chains only (trigger → code [→ code]).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HELPERS = readFileSync(resolve('n8n/workflows/src/helpers.js'), 'utf8');
const PARSE_LIB = readFileSync(resolve('n8n/lib/parse-score-output.js'), 'utf8')
  .replace(/module\.exports[\s\S]*$/, ''); // strip CommonJS export for inlining

let n = 0;
const pos = () => [260 * ++n, 0];
const nid = (name) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${n}`;

export function webhook(name, path) {
  return { id: nid(name), name, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos(),
    parameters: { httpMethod: 'POST', path, responseMode: 'onReceived' } };
}

export function schedule(name, minutes) {
  return { id: nid(name), name, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: pos(),
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: minutes }] } } };
}

export function code(name, agent, jsCode, { withParser = false } = {}) {
  const prelude = `const WORKFLOW_AGENT = '${agent}';\n${HELPERS}\n${withParser ? PARSE_LIB + '\n' : ''}`;
  return { id: nid(name), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(),
    parameters: { mode: 'runOnceForAllItems', jsCode: prelude + jsCode } };
}

export function workflow(wfId, name, nodes) {
  const connections = {};
  for (let i = 0; i < nodes.length - 1; i++) {
    connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
  }
  return { id: wfId, name, active: true, nodes, connections, settings: { executionOrder: 'v1' } };
}
```

Create `n8n/build.mjs`:

```js
// Compiles n8n/workflows/src/*.workflow.mjs into importable JSON in n8n/dist/.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = resolve('n8n/workflows/src');
const DIST = resolve('n8n/dist');
mkdirSync(DIST, { recursive: true });

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.workflow.mjs'))) {
  const mod = await import(pathToFileURL(join(SRC, file)).href);
  const wf = mod.default;
  writeFileSync(join(DIST, `${wf.id}.json`), JSON.stringify(wf, null, 2));
  console.log('built', wf.id);
}
```

Create `n8n/apply.sh`:

```bash
#!/usr/bin/env bash
# Build workflow JSON, import into the running n8n container, restart to (re)activate.
set -euo pipefail
cd "$(dirname "$0")/.."
node n8n/build.mjs
docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
docker compose restart n8n
echo "waiting for n8n..."
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:5678/healthz && { echo "n8n up"; exit 0; }
  sleep 2
done
echo "n8n did not come back" >&2; exit 1
```

`chmod +x n8n/apply.sh`. (Verify at build time: `import:workflow` with a custom `id` updates the existing
workflow on re-import instead of duplicating — if the installed n8n rejects the custom id format, switch to
IDs it generates on first import and keep them in the source files.)

- [ ] **Step 4: Heartbeat workflow proves the pipeline**

Create `n8n/workflows/src/heartbeat.workflow.mjs`:

```js
import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Ping', 'ping');
const pong = code('Pong', 'orchestrator', `
return [{ json: { ok: true, at: new Date().toISOString() } }];
`);

export default workflow('agencyos-heartbeat', 'AgencyOS Heartbeat', [trigger, pong]);
```

Create `n8n/tests/lib.sh`:

```bash
#!/usr/bin/env bash
# Shared helpers for n8n golden-path tests. Source from each test script.
API=http://localhost:3000
KEY=dev-agent-key-change-me
PSQL="docker compose exec -T db psql -U agency -tA -c"

api_get()  { curl -s -H "x-agent-api-key: $KEY" "$API$1"; }
api_post() { curl -s -X POST -H "x-agent-api-key: $KEY" -H 'content-type: application/json' -d "$2" "$API$1"; }

# wait_for <description> <command producing a number> <minimum>
wait_for() {
  local desc="$1" cmd="$2" want="$3" got=0
  for _ in $(seq 1 45); do
    got=$(eval "$cmd" 2>/dev/null || echo 0)
    if [ "${got:-0}" -ge "$want" ] 2>/dev/null; then echo "OK: $desc ($got)"; return 0; fi
    sleep 2
  done
  echo "TIMEOUT: $desc (last=$got)"; return 1
}

ORG_ID=$($PSQL "select id from orgs where name = 'Sunday AI Work'")
export ORG_ID
```

`KEY` here must match whatever `AGENT_API_KEY` actually holds in `.env` — it defaults to the
same `dev-agent-key-change-me` seeded by Plan 1a's `.env.example`, so this only needs updating
if that value is ever changed for this environment.

Run the pipeline end to end:

```bash
bash n8n/apply.sh
sleep 5
curl -s -X POST http://localhost:5678/webhook/ping -H 'content-type: application/json' -d '{}'
```

Expected: n8n's immediate-ack response (`{"message":"Workflow was started"}`), and the execution shows
success in the n8n UI (`http://localhost:5678`, Executions tab). If the webhook 404s, the workflow didn't
activate — check `docker compose logs n8n`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: n8n + mailpit infra, workflows-as-code build pipeline, heartbeat"
```

---

### Task 8: Orchestrator workflow

**Files:**
- Create: `n8n/workflows/src/orchestrator.workflow.mjs`, `n8n/tests/orchestrator.sh`

**Interfaces:**
- Consumes: helpers (Task 7); `POST /api/agent/decisions` (Plan 1a).
- Produces: `POST http://localhost:5678/webhook/signal` `{ org_id, type, payload }` — routes `job_order.created` → sourcing webhook, acknowledges `candidate.ingested`, and raises a `risk.alert` decision for unknown signal types. Deterministic routing — no LLM in v1 (spec: "mostly deterministic n8n routing"); an LLM classifier is added only when inbound-reply routing arrives in Phase 2.

- [ ] **Step 1: Workflow definition**

Create `n8n/workflows/src/orchestrator.workflow.mjs`:

```js
import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Signal In', 'signal');

const route = code('Route Signal', 'orchestrator', `
const b = $json.body ?? $json;
const { org_id, type, payload = {} } = b;
if (!org_id || !type) throw new Error('signal requires org_id and type');

if (type === 'job_order.created') {
  if (!payload.job_order_id) throw new Error('job_order.created requires payload.job_order_id');
  await http({ method: 'POST', url: 'http://localhost:5678/webhook/source',
    body: { org_id, job_order_id: payload.job_order_id }, json: true });
  return [{ json: { routed: 'sourcing' } }];
}

if (type === 'candidate.ingested') {
  // No downstream consumer in Phase 1 — acknowledged for the audit trail.
  return [{ json: { routed: 'none' } }];
}

await proposeDecision({
  org_id, agent: 'orchestrator', action_class: 'risk.alert',
  reasoning: {
    summary: 'Unrecognized signal type: ' + type,
    evidence: [JSON.stringify(payload).slice(0, 500)],
    model: 'deterministic', prompt_version: 'orchestrator-v1',
  },
  payload: { signal_type: type },
});
return [{ json: { routed: 'risk' } }];
`);

export default workflow('agencyos-orchestrator', 'AgencyOS Orchestrator', [trigger, route]);
```

- [ ] **Step 2: Golden-path test**

Create `n8n/tests/orchestrator.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

TYPE="totally.unknown.$(date +%s)"
curl -s -X POST http://localhost:5678/webhook/signal -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"type\":\"$TYPE\",\"payload\":{\"noise\":true}}"
echo

wait_for "risk card raised for unknown signal" \
  "$PSQL \"select count(*) from decisions where action_class='risk.alert' and reasoning->>'summary' = 'Unrecognized signal type: $TYPE'\"" 1
```

- [ ] **Step 3: Apply and run**

```bash
chmod +x n8n/tests/*.sh
bash n8n/apply.sh
bash n8n/tests/orchestrator.sh
```

Expected: `OK: risk card raised for unknown signal (1)`. The card also appears in the cockpit queue at
`http://localhost:3000/` with a Resolve button (Plan 1b renders risk-tier cards).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: orchestrator workflow — deterministic signal routing + risk cards"
```

---

### Task 9: Data Steward workflow — ingest, dedupe, embed

**Files:**
- Create: `n8n/workflows/src/data-steward.workflow.mjs`, `n8n/tests/data-steward.sh`

**Interfaces:**
- Consumes: `POST /api/agent/candidates`, `POST /api/agent/embeddings`, decision propose/transition, `POST /api/agent/runs`; Gemini embeddings; orchestrator's `/webhook/signal`.
- Produces: `POST http://localhost:5678/webhook/ingest-candidate` `{ org_id, candidate: { full_name, email?, phone?, current_title?, location?, source? }, resume_text? }` → deduped candidate + resume document + 3072-dim chunk embeddings + an executed `data.enrich_record` decision + a `candidate.ingested` signal.

- [ ] **Step 1: Workflow definition**

Create `n8n/workflows/src/data-steward.workflow.mjs`:

```js
import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Ingest In', 'ingest-candidate');

const ingest = code('Ingest Candidate', 'data-steward', `
const b = $json.body ?? $json;
const { org_id, candidate = {}, resume_text = null } = b;
if (!org_id || !candidate.full_name) throw new Error('ingest requires org_id and candidate.full_name');

const ing = await apiPost('/api/agent/candidates', { org_id, ...candidate, resume_text });

const d = await proposeDecision({
  org_id, agent: 'data-steward', action_class: 'data.enrich_record',
  reasoning: {
    summary: 'Ingested candidate ' + candidate.full_name + (ing.deduped ? ' (deduped into existing record)' : ' (new record)'),
    evidence: [], model: 'deterministic', prompt_version: 'steward-v1',
  },
  payload: { candidate_id: ing.candidate_id },
  candidate_id: ing.candidate_id,
});
await completeDecision(d.decision.id, {
  candidate_id: ing.candidate_id, document_id: ing.document_id, deduped: ing.deduped,
});

if (resume_text && ing.document_id) {
  const chunks = chunkText(resume_text);
  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    rows.push({
      chunk_index: i, content: chunks[i],
      embedding: await embed(chunks[i]),
      content_hash: sha256(chunks[i]),
    });
  }
  await apiPost('/api/agent/embeddings', {
    org_id, subject_type: 'candidate_document', subject_id: ing.document_id, chunks: rows,
  });
  await apiPost('/api/agent/runs', {
    org_id, agent: 'data-steward', workflow: 'agencyos-data-steward',
    model: 'gemini-embedding-001', prompt_version: null,
    tokens_in: null, tokens_out: null, status: 'succeeded', decision_id: d.decision.id,
  });
}

await http({ method: 'POST', url: 'http://localhost:5678/webhook/signal',
  body: { org_id, type: 'candidate.ingested', payload: { candidate_id: ing.candidate_id } }, json: true });

return [{ json: { candidate_id: ing.candidate_id, deduped: ing.deduped } }];
`);

export default workflow('agencyos-data-steward', 'AgencyOS Data Steward', [trigger, ingest]);
```

- [ ] **Step 2: Golden-path test**

Create `n8n/tests/data-steward.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

NAME="Steward Golden $(date +%s)"
BODY=$(cat <<JSON
{"org_id":"$ORG_ID",
 "candidate":{"full_name":"$NAME","email":"steward-$(date +%s)@example.com","current_title":"Senior React Developer"},
 "resume_text":"Senior React Developer with 9 years building TypeScript SPAs on AWS. Led a team of 5. Migrated a legacy monolith to Next.js. Strong testing culture with Vitest and Playwright."}
JSON
)
curl -s -X POST http://localhost:5678/webhook/ingest-candidate -H 'content-type: application/json' -d "$BODY"
echo

wait_for "candidate row created" \
  "$PSQL \"select count(*) from candidates where full_name = '$NAME'\"" 1
wait_for "steward decision executed" \
  "$PSQL \"select count(*) from decisions where agent='data-steward' and state='executed' and reasoning->>'summary' like 'Ingested candidate $NAME%'\"" 1
wait_for "embeddings written for the resume" \
  "$PSQL \"select count(*) from embeddings e join candidate_documents cd on cd.id = e.subject_id join candidates c on c.id = cd.candidate_id where c.full_name = '$NAME'\"" 1
```

- [ ] **Step 3: Apply and run**

```bash
bash n8n/apply.sh
bash n8n/tests/data-steward.sh
```

Expected: all three `OK:` lines (needs `npm run dev` running and a valid `GEMINI_API_KEY`).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: data steward workflow — dedupe ingest, chunk + embed, audited via decision record"
```

---

### Task 10: Sourcing workflow — vector shortlist

**Files:**
- Create: `n8n/workflows/src/sourcing.workflow.mjs`, `n8n/tests/sourcing-screening.sh` (covers Tasks 10–11)

**Interfaces:**
- Consumes: `GET /api/agent/job-orders/:id`, `POST /api/agent/search/candidates`, decision propose/complete, runs telemetry; Gemini embeddings; hands off to `/webhook/screen`.
- Produces: `POST http://localhost:5678/webhook/source` `{ org_id, job_order_id }` → executed `source.shortlist` decision with ranked candidates and distance evidence, then triggers Screening with the shortlist.

- [ ] **Step 1: Workflow definition**

Create `n8n/workflows/src/sourcing.workflow.mjs`:

```js
import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Source In', 'source');

const source = code('Build Shortlist', 'sourcing', `
const b = $json.body ?? $json;
const { org_id, job_order_id } = b;
if (!org_id || !job_order_id) throw new Error('source requires org_id and job_order_id');

const { job_order: job } = await apiGet('/api/agent/job-orders/' + job_order_id, { org_id });

const jobText = [
  job.title,
  job.description ?? '',
  'Must have: ' + JSON.stringify(job.must_haves ?? []),
  'Nice to have: ' + JSON.stringify(job.nice_to_haves ?? []),
].join('\\n');
const queryEmbedding = await embed(jobText);
await apiPost('/api/agent/runs', {
  org_id, agent: 'sourcing', workflow: 'agencyos-sourcing',
  model: 'gemini-embedding-001', prompt_version: null,
  tokens_in: null, tokens_out: null, status: 'succeeded', decision_id: null,
});

const { results } = await apiPost('/api/agent/search/candidates', {
  org_id, query_embedding: queryEmbedding, limit: 10,
});

const d = await proposeDecision({
  org_id, agent: 'sourcing', action_class: 'source.shortlist',
  reasoning: {
    summary: 'Shortlisted ' + results.length + ' candidates for "' + job.title + '" by vector similarity over the internal pool',
    evidence: results.map((r) => r.full_name + ': distance ' + Number(r.distance).toFixed(4)),
    model: 'gemini-embedding-001', prompt_version: 'sourcing-v1',
  },
  payload: { candidate_ids: results.map((r) => r.candidate_id), ranked: results },
  job_order_id,
});
await completeDecision(d.decision.id, { shortlisted: results.length });

if (results.length > 0) {
  await http({ method: 'POST', url: 'http://localhost:5678/webhook/screen',
    body: { org_id, job_order_id, candidate_ids: results.map((r) => r.candidate_id) }, json: true });
}
return [{ json: { shortlisted: results.length } }];
`);

export default workflow('agencyos-sourcing', 'AgencyOS Sourcing', [trigger, source]);
```

- [ ] **Step 2: Golden-path test (shared with Screening)**

Create `n8n/tests/sourcing-screening.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

# Needs at least one embedded candidate — run data-steward.sh first if the pool is empty.
JOB_ID=$($PSQL "insert into job_orders (org_id, title, description, kind, must_haves)
  values ('$ORG_ID', 'Senior React Developer (golden)', 'Build and test React + TypeScript apps on AWS.',
          'contract', '[\"React\",\"TypeScript\",\"AWS\"]'::jsonb) returning id")
echo "job: $JOB_ID"

curl -s -X POST http://localhost:5678/webhook/signal -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"type\":\"job_order.created\",\"payload\":{\"job_order_id\":\"$JOB_ID\"}}"
echo

wait_for "shortlist decision executed" \
  "$PSQL \"select count(*) from decisions where action_class='source.shortlist' and job_order_id='$JOB_ID' and state='executed'\"" 1
wait_for "at least one score persisted" \
  "$PSQL \"select count(*) from scores where job_order_id='$JOB_ID'\"" 1
wait_for "screening decisions executed" \
  "$PSQL \"select count(*) from decisions where action_class='screen.score_resume' and job_order_id='$JOB_ID' and state='executed'\"" 1
echo "queue cards for this job (tier-2 outreach and/or risk):"
$PSQL "select action_class, tier, state from decisions where job_order_id='$JOB_ID' order by proposed_at"
```

(Run after Task 11 is applied — the script asserts the full source → screen chain. Outreach vs risk cards
depend on live model scores; the assertions are structural.)

- [ ] **Step 3: Apply and commit**

```bash
bash n8n/apply.sh
git add -A
git commit -m "feat: sourcing workflow — embedded job query, ranked shortlist decision, screen handoff"
```

---

### Task 11: Screening workflow — calibrated scorer + outreach drafts

**Files:**
- Create: `n8n/workflows/src/screening.workflow.mjs`

**Interfaces:**
- Consumes: `GET /api/agent/prompts` (active `resume-scorer`), `GET /api/agent/candidates/:id` (candidate + resume), `GET /api/agent/job-orders/:id`, `POST /api/agent/scores`, decision propose/complete, runs telemetry; `parseScoreOutput` (inlined via `code(..., { withParser: true })`); Gemini `gemini-2.5-flash`.
- Produces: `POST http://localhost:5678/webhook/screen` `{ org_id, job_order_id, candidate_ids[] }` → per candidate: `scores` row + executed `screen.score_resume` decision; `yes` → tier-2 `comms.candidate_outreach` decision with a drafted email in the payload (the undo-window card in the cockpit); `borderline` → `risk.alert` card; `no` → score only. Candidates without a resume or email are surfaced, never silently dropped. **Each candidate's whole processing body is wrapped in its own try/catch, catching into a `risk.alert` card** — Screening has no scheduled retry (unlike Communication Agent's every-minute poll), so an uncaught error on one candidate (a blocked/malformed Gemini response, a bad draft `JSON.parse`) would otherwise permanently drop every candidate after it in the shortlist with zero visibility, not just delay them.

- [ ] **Step 1: Workflow definition**

Create `n8n/workflows/src/screening.workflow.mjs`:

```js
import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Screen In', 'screen');

const screen = code('Score Candidates', 'screening', `
const b = $json.body ?? $json;
const { org_id, job_order_id, candidate_ids = [] } = b;
if (!org_id || !job_order_id) throw new Error('screen requires org_id and job_order_id');

const { prompt } = await apiGet('/api/agent/prompts', { org_id, agent: 'screening', name: 'resume-scorer' });
const spec = JSON.parse(prompt.body); // { system, user_template }
const { job_order: job } = await apiGet('/api/agent/job-orders/' + job_order_id, { org_id });

const out = [];
for (const candidate_id of candidate_ids) {
  // Whole-candidate isolation: unlike Communication Agent, Screening runs once per webhook
  // call with no scheduled retry — an uncaught error here (a blocked/malformed Gemini
  // response, a bad draft JSON.parse, a transient API call) would otherwise permanently
  // leave every candidate after this one in the shortlist unscored, with zero visibility.
  try {
    const cr = await apiGet('/api/agent/candidates/' + candidate_id, { org_id });
    const cand = cr.candidate;

    if (!cr.resume || !cr.resume.parsed_text) {
      await proposeDecision({
        org_id, agent: 'screening', action_class: 'risk.alert',
        reasoning: { summary: 'Shortlisted candidate ' + cand.full_name + ' has no resume on file — cannot screen',
          evidence: [], model: 'deterministic', prompt_version: prompt.version },
        payload: { candidate_id, job_order_id }, job_order_id, candidate_id,
      });
      out.push({ candidate_id, fit: 'unscreened' });
      continue;
    }

    // replaceAll, not replace: string .replace() only substitutes the FIRST occurrence.
    // A repeated placeholder in a future prompt version would otherwise reach Gemini
    // as literal unsubstituted text, and the structural golden tests would not catch it.
    const user = spec.user_template
      .replaceAll('{job_title}', job.title)
      .replaceAll('{company_name}', '')
      .replaceAll('{skills}', JSON.stringify(job.must_haves ?? []))
      .replaceAll('{summary_text}', job.description ?? '')
      .replaceAll('{fulltext_excerpt}', JSON.stringify(job.nice_to_haves ?? []))
      .replaceAll('{pay_rate_max}', '')
      .replaceAll('{start_date}', '')
      .replaceAll('{end_date}', '')
      .replaceAll('{resume_text}', cr.resume.parsed_text.slice(0, 30000))
      .replaceAll('{candidate_name}', cand.full_name)
      .replaceAll('{evaluated_at}', new Date().toISOString());

    const resp = await generateJson('gemini-2.5-flash', spec.system, user);
    const parsed = parseScoreOutput(resp);
    const usage = resp.usageMetadata ?? {};

    await apiPost('/api/agent/scores', {
      org_id, job_order_id, candidate_id,
      prompt_version: prompt.version, model: 'gemini-2.5-flash',
      fit_rating: parsed.agent_label, weighted_score: parsed.fit_percentage / 100,
      criteria: parsed,
    });

    const sd = await proposeDecision({
      org_id, agent: 'screening', action_class: 'screen.score_resume',
      reasoning: {
        summary: 'Scored ' + cand.full_name + ' at ' + parsed.fit_percentage + '% (' + parsed.agent_label + ')'
          + (parsed.c01_gate_fired ? ' — C01 hard gate fired' : ''),
        evidence: parsed.top_strengths.concat(parsed.key_gaps),
        model: 'gemini-2.5-flash', prompt_version: prompt.version,
      },
      payload: { fit_rating: parsed.agent_label, weighted_score: parsed.fit_percentage / 100 },
      job_order_id, candidate_id,
    });
    await completeDecision(sd.decision.id, { fit_rating: parsed.agent_label });
    await apiPost('/api/agent/runs', {
      org_id, agent: 'screening', workflow: 'agencyos-screening',
      model: 'gemini-2.5-flash', prompt_version: prompt.version,
      tokens_in: usage.promptTokenCount ?? null, tokens_out: usage.candidatesTokenCount ?? null,
      status: 'succeeded', decision_id: sd.decision.id,
    });

    if (parsed.agent_label === 'yes') {
      if (!cand.email) {
        await proposeDecision({
          org_id, agent: 'screening', action_class: 'risk.alert',
          reasoning: { summary: cand.full_name + ' scored ' + parsed.fit_percentage + '% but has no email on file',
            evidence: parsed.top_strengths, model: 'deterministic', prompt_version: prompt.version },
          payload: { candidate_id, job_order_id }, job_order_id, candidate_id,
        });
      } else {
        const draft = await generateJson('gemini-2.5-flash',
          'You draft short, warm, professional recruiting outreach emails. Return ONLY JSON: {"subject": string, "body": string}. Write a complete, sendable email with no placeholders. Sign off as "the Sunday AI Work recruiting team".',
          'Job: ' + job.title + '\\nCandidate: ' + cand.full_name
            + '\\nWhy they fit: ' + parsed.recommendation
            + '\\nTop strengths: ' + parsed.top_strengths.join('; ')
            + '\\nWrite the outreach email inviting a quick intro call this week.', 0.4);
        const dj = JSON.parse(draft.candidates[0].content.parts[0].text);
        await apiPost('/api/agent/runs', {
          org_id, agent: 'screening', workflow: 'agencyos-screening',
          model: 'gemini-2.5-flash', prompt_version: 'outreach-draft-v1',
          tokens_in: draft.usageMetadata?.promptTokenCount ?? null,
          tokens_out: draft.usageMetadata?.candidatesTokenCount ?? null,
          status: 'succeeded', decision_id: null,
        });
        await proposeDecision({
          org_id, agent: 'screening', action_class: 'comms.candidate_outreach',
          reasoning: {
            summary: 'Outreach draft for ' + cand.full_name + ' — scored ' + parsed.fit_percentage + '% for ' + job.title,
            evidence: parsed.top_strengths, model: 'gemini-2.5-flash', prompt_version: 'outreach-draft-v1',
          },
          payload: { channel: 'email', to: cand.email, subject: dj.subject, body: dj.body, candidate_id },
          job_order_id, candidate_id,
        }); // tier 2 → auto-approved with an undo window; Communication Agent executes after expiry
      }
    } else if (parsed.agent_label === 'borderline') {
      await proposeDecision({
        org_id, agent: 'screening', action_class: 'risk.alert',
        reasoning: {
          summary: 'Borderline screen for ' + cand.full_name + ' (' + parsed.fit_percentage + '%) — needs human review',
          evidence: parsed.key_gaps, model: 'gemini-2.5-flash', prompt_version: prompt.version,
        },
        payload: { candidate_id, job_order_id, fit_percentage: parsed.fit_percentage },
        job_order_id, candidate_id,
      });
    }
    out.push({ candidate_id, fit: parsed.agent_label });
  } catch (err) {
    // Surface it, don't just swallow it — same visibility pattern as the "no resume" /
    // "no email" branches above, so a recruiter sees this candidate needs a human look
    // instead of it silently vanishing from the shortlist's results.
    await proposeDecision({
      org_id, agent: 'screening', action_class: 'risk.alert',
      reasoning: {
        summary: 'Screening failed for candidate ' + candidate_id + ': ' + String((err && err.message) || err),
        evidence: [], model: 'deterministic', prompt_version: prompt.version,
      },
      payload: { candidate_id, job_order_id }, job_order_id, candidate_id,
    });
    out.push({ candidate_id, fit: 'error' });
  }
}
return out.length ? out.map((o) => ({ json: o })) : [{ json: { screened: 0 } }];
`, { withParser: true });

export default workflow('agencyos-screening', 'AgencyOS Screening', [trigger, screen]);
```

- [ ] **Step 2: Apply and run the chain test**

```bash
bash n8n/apply.sh
bash n8n/tests/data-steward.sh        # ensure at least one embedded candidate exists
bash n8n/tests/sourcing-screening.sh
```

Expected: all `wait_for` lines print `OK:`; the final query lists `source.shortlist` (executed),
`screen.score_resume` (executed), and — depending on live scores — `comms.candidate_outreach` (tier 2,
approved, countdown card in the cockpit) and/or `risk.alert` cards. **This is the Phase-1 spec outcome:
job order in → scored shortlist with approvable outreach out.**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: screening workflow — calibrated v2.2.0 scorer + C01 gate, outreach drafts, risk cards"
```

---

### Task 12: Communication Agent executor

**Files:**
- Create: `n8n/workflows/src/communication.workflow.mjs`, `n8n/tests/communication.sh`

**Interfaces:**
- Consumes: `GET /api/agent/decisions/executable?action_prefix=comms.` (Task 1), `POST /api/agent/compliance/check` (Task 3), Mailpit `$env.MAIL_API_URL` (Task 7), `POST /api/agent/messages` (Task 2), transitions.
- Produces: a schedule-triggered (every minute) executor — the **only** component that sends email. Per executable decision: compliance `defer` → skip (retried next tick); `deny` → `executing` → `failed` with `compliance_denied: <reasons>` on the record; `allow` → send via Mail API → log message (threaded to the decision) → `executed` with `{ message_id }`. Send failures → `failed` with the transport error. **Each decision's whole processing body is wrapped in its own try/catch** — a compliance-check failure, a lost ADR-0003 race (409, someone else already transitioned it), or any other per-decision error is recorded and the loop moves on to the rest of the batch. Without this, one bad decision throws out of the Code node and silently drops every decision queued after it for that tick — and since `listExecutable` orders oldest-first, a decision that fails the *same way every time* would permanently starve the whole queue behind it, not just delay one tick.

- [ ] **Step 1: Workflow definition**

Create `n8n/workflows/src/communication.workflow.mjs`:

```js
import { schedule, code, workflow } from './lib.mjs';

const tick = schedule('Every Minute', 1);

const send = code('Execute Comms Decisions', 'communication', `
const { queue } = await apiGet('/api/agent/decisions/executable', { action_prefix: 'comms.' });
const results = [];

for (const d of queue) {
  // Whole-decision isolation: a lost ADR-0003 race (someone else transitioned this
  // decision between listExecutable and now — surfaced as a 409), a compliance-check
  // network blip, or any other per-decision error must not abort the batch. Without this
  // outer try/catch, one bad decision throws out of the loop and every decision queued
  // after it (listExecutable orders oldest-first) silently doesn't get processed this tick.
  try {
    const p = d.payload ?? {};
    const check = await apiPost('/api/agent/compliance/check', {
      org_id: d.org_id, candidate_id: d.candidate_id, channel: p.channel ?? 'email',
    });

    if (check.verdict === 'defer') {
      results.push({ id: d.id, action: 'deferred', reasons: check.reasons });
      continue; // stays approved; retried next tick
    }

    await transition(d.id, 'executing');

    if (check.verdict === 'deny') {
      await transition(d.id, 'failed', { error: 'compliance_denied: ' + check.reasons.join(',') });
      results.push({ id: d.id, action: 'denied', reasons: check.reasons });
      continue;
    }

    try {
      if (!p.to || !p.subject || !p.body) throw new Error('payload requires to, subject, body');
      await http({ method: 'POST', url: $env.MAIL_API_URL, json: true, body: {
        From: { Email: $env.MAIL_FROM, Name: 'Sunday AI Work Recruiting' },
        To: [{ Email: p.to }],
        Subject: p.subject,
        Text: p.body,
      }});
      const logged = await apiPost('/api/agent/messages', {
        org_id: d.org_id, candidate_id: d.candidate_id, channel: 'email',
        direction: 'outbound', body: 'Subject: ' + p.subject + '\\n\\n' + p.body, decision_id: d.id,
      });
      await transition(d.id, 'executed', { outcome: { message_id: logged.message_id } });
      results.push({ id: d.id, action: 'sent' });
    } catch (err) {
      // Decision is already 'executing' at this point — safe to transition to failed.
      await transition(d.id, 'failed', { error: String((err && err.message) || err) });
      results.push({ id: d.id, action: 'failed' });
    }
  } catch (err) {
    // Failed before or during the move to 'executing' (e.g. the compliance check itself
    // errored, or transition() returned 409 because someone else already resolved this
    // decision). Don't call transition('failed') here — we may not even know the decision
    // is still in a state that accepts it. Just record and move on to the rest of the batch.
    results.push({ id: d.id, action: 'skipped', error: String((err && err.message) || err) });
  }
}
return results.length ? results.map((r) => ({ json: r })) : [{ json: { checked: 0 } }];
`);

export default workflow('agencyos-communication', 'AgencyOS Communication', [tick, send]);
```

- [ ] **Step 2: Golden-path test**

Create `n8n/tests/communication.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"

STAMP=$(date +%s)

# --- happy path: outreach decision → email in Mailpit, message logged, decision executed ---
HAPPY=$($PSQL "insert into candidates (org_id, full_name, email)
  values ('$ORG_ID', 'Comms Happy $STAMP', 'happy-$STAMP@example.com') returning id")
D1=$(api_post /api/agent/decisions "{\"org_id\":\"$ORG_ID\",\"agent\":\"screening\",\"action_class\":\"comms.candidate_outreach\",
  \"reasoning\":{\"summary\":\"comms golden\",\"evidence\":[],\"model\":\"manual\",\"prompt_version\":\"v0\"},
  \"payload\":{\"channel\":\"email\",\"to\":\"happy-$STAMP@example.com\",\"subject\":\"Golden $STAMP\",\"body\":\"Hello from the golden path.\"},
  \"candidate_id\":\"$HAPPY\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).decision.id))")

# --- deny path: revoked consent must fail the decision, never send ---
DENIED=$($PSQL "insert into candidates (org_id, full_name, email)
  values ('$ORG_ID', 'Comms Denied $STAMP', 'denied-$STAMP@example.com') returning id")
$PSQL "insert into consents (org_id, candidate_id, channel, status) values ('$ORG_ID', '$DENIED', 'email', 'revoked')" > /dev/null
D2=$(api_post /api/agent/decisions "{\"org_id\":\"$ORG_ID\",\"agent\":\"screening\",\"action_class\":\"comms.candidate_outreach\",
  \"reasoning\":{\"summary\":\"comms denied golden\",\"evidence\":[],\"model\":\"manual\",\"prompt_version\":\"v0\"},
  \"payload\":{\"channel\":\"email\",\"to\":\"denied-$STAMP@example.com\",\"subject\":\"Should never send $STAMP\",\"body\":\"nope\"},
  \"candidate_id\":\"$DENIED\"}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).decision.id))")

# Fast-forward both undo windows (tier-2 default is 15 min).
$PSQL "update decisions set undo_expires_at = now() - interval '1 minute' where id in ('$D1','$D2')" > /dev/null

wait_for "happy decision executed" \
  "$PSQL \"select count(*) from decisions where id='$D1' and state='executed'\"" 1
wait_for "email landed in Mailpit" \
  "curl -s 'http://localhost:8025/api/v1/search?query=Golden%20$STAMP' | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).messages_count))\"" 1
wait_for "message logged and threaded to the decision" \
  "$PSQL \"select count(*) from messages where decision_id='$D1'\"" 1
wait_for "denied decision failed with compliance reason" \
  "$PSQL \"select count(*) from decisions where id='$D2' and state='failed' and error like 'compliance_denied:%'\"" 1

MAILED=$($PSQL "select count(*) from messages where decision_id='$D2'")
[ "$MAILED" = "0" ] && echo "OK: denied decision never sent" || { echo "FAIL: denied decision sent mail"; exit 1; }
```

(Note: this test runs inside the 08:00–20:00 America/New_York send window; outside it the gate defers by
design — run it during the day or temporarily widen `QUIET_HOURS` locally.)

- [ ] **Step 3: Apply and run**

```bash
bash n8n/apply.sh
bash n8n/tests/communication.sh
```

Expected: all `OK:` lines, including `denied decision never sent`. Open `http://localhost:8025` to see the
sent email; the cockpit queue shows the tier-2 card counting down before execution if you re-run without
fast-forwarding.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: communication executor — compliance-gated email sends with full audit trail"
```

---

### Task 13: End-to-end golden path + docs

**Files:**
- Create: `n8n/tests/e2e-golden-path.sh`
- Modify: `README.md` (agent runtime section)

**Interfaces:**
- Consumes: everything above.
- Produces: one script proving the whole Phase-1 loop; the runtime surface Plan 1d deploys to AWS.

- [ ] **Step 1: The end-to-end script**

Create `n8n/tests/e2e-golden-path.sh`:

```bash
#!/usr/bin/env bash
# Phase 1 golden path: ingest candidates → job order signal → shortlist → scores →
# outreach card → undo window → compliance gate → email in Mailpit.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
STAMP=$(date +%s)

echo "== 1. ingest a strong candidate =="
curl -s -X POST http://localhost:5678/webhook/ingest-candidate -H 'content-type: application/json' -d "{
  \"org_id\":\"$ORG_ID\",
  \"candidate\":{\"full_name\":\"E2E Strong $STAMP\",\"email\":\"e2e-strong-$STAMP@example.com\",\"current_title\":\"Senior React Developer\"},
  \"resume_text\":\"Senior React Developer, 9 years. Deep React, TypeScript, Next.js, AWS (ECS, RDS, S3). Led migration to App Router. Contract roles completed end-to-end. Strong communication; quantified impact: cut page load 60%.\"}"
echo
wait_for "strong candidate embedded" \
  "$PSQL \"select count(*) from embeddings e join candidate_documents cd on cd.id=e.subject_id join candidates c on c.id=cd.candidate_id where c.full_name='E2E Strong $STAMP'\"" 1

echo "== 2. job order arrives as a signal =="
JOB_ID=$($PSQL "insert into job_orders (org_id, title, description, kind, must_haves)
  values ('$ORG_ID', 'E2E Senior React Developer $STAMP', 'Senior React + TypeScript contractor to build Next.js apps on AWS.',
          'contract', '[\"React\",\"TypeScript\",\"Next.js\",\"AWS\"]'::jsonb) returning id")
curl -s -X POST http://localhost:5678/webhook/signal -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"type\":\"job_order.created\",\"payload\":{\"job_order_id\":\"$JOB_ID\"}}"
echo

echo "== 3. spine produces shortlist + scores =="
wait_for "shortlist executed" \
  "$PSQL \"select count(*) from decisions where action_class='source.shortlist' and job_order_id='$JOB_ID' and state='executed'\"" 1
wait_for "scores persisted" \
  "$PSQL \"select count(*) from scores where job_order_id='$JOB_ID'\"" 1

echo "== 4. approvable outreach (or risk) cards exist =="
wait_for "post-screen cards raised" \
  "$PSQL \"select count(*) from decisions where job_order_id='$JOB_ID' and action_class in ('comms.candidate_outreach','risk.alert')\"" 1

echo "== 5. fast-forward undo windows; executor sends =="
$PSQL "update decisions set undo_expires_at = now() - interval '1 minute'
       where job_order_id='$JOB_ID' and action_class='comms.candidate_outreach' and state='approved'" > /dev/null
SENT_EXPECTED=$($PSQL "select count(*) from decisions where job_order_id='$JOB_ID' and action_class='comms.candidate_outreach'")
if [ "$SENT_EXPECTED" -ge 1 ]; then
  wait_for "outreach executed" \
    "$PSQL \"select count(*) from decisions where job_order_id='$JOB_ID' and action_class='comms.candidate_outreach' and state='executed'\"" 1
  wait_for "email in Mailpit" \
    "curl -s 'http://localhost:8025/api/v1/search?query=e2e-strong-$STAMP@example.com' | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).messages_count))\"" 1
else
  echo "NOTE: live scorer rated the candidate below 'yes' — check risk cards in the cockpit instead."
fi

echo "== E2E COMPLETE =="
$PSQL "select agent, action_class, tier, state from decisions where job_order_id='$JOB_ID' order by proposed_at"
```

- [ ] **Step 2: Run it**

```bash
chmod +x n8n/tests/e2e-golden-path.sh
bash n8n/tests/e2e-golden-path.sh
```

Expected: every `wait_for` prints `OK:` (step 5's email assertions apply when the live scorer rates the
candidate `yes` — the strong fixture resume is written to score well against the fixture job). The closing
table shows the full audit trail: `data.enrich_record`, `source.shortlist`, `screen.score_resume` (executed)
and `comms.candidate_outreach` (executed) / `risk.alert` (proposed).

- [ ] **Step 3: README section**

Append to `README.md`:

```markdown
## Agent runtime (Phase 1c)

n8n (http://localhost:5678) + Mailpit (http://localhost:8025), via `docker compose up -d`.
Workflows are code: `n8n/workflows/src/*.workflow.mjs` → `bash n8n/apply.sh` (build, import, restart).

Agents: orchestrator (`/webhook/signal`), data-steward (`/webhook/ingest-candidate`),
sourcing (`/webhook/source`), screening (`/webhook/screen`), communication (1-min schedule).
All world access goes through `/api/agent/*` with `x-agent-api-key` — n8n has no DB access.
Scorer: calibrated v2.2.0 + C01-hard-gate-v2 (`n8n/lib/parse-score-output.js`, prompts seeded
from `n8n/prompts/`). Compliance gate: consent deny, quiet-hours/frequency defer.

Golden tests (need `npm run dev` + `GEMINI_API_KEY`): `bash n8n/tests/e2e-golden-path.sh`.
```

- [ ] **Step 4: Full verification and commit**

```bash
npm test
git add -A
git commit -m "docs+test: e2e golden path — job order in, scored shortlist and sent outreach out"
```

---

## Self-Review Results

- **Spec coverage:** every task in the design doc's execution strategy maps to a task here in
  the same order (API surface Tasks 1–6, n8n infra Task 7, five workflows Tasks 8–12, e2e Task
  13); all five corrections from the design doc are applied — Task 1 preserves the CAS guard
  and adds Step 5 (fold the existing route onto `requireAgentKey`), Task 4's interface note
  states the `'candidate_document'` subject_type explicitly, Task 7's compose snippet
  interpolates `AGENT_API_KEY` and flags the n8n image pin.
- **Placeholder scan:** one intentional exception — Task 7's `n8nio/n8n:<pin-this-at-build-time>`
  is a deliberate build-time instruction (run a version-check command, hard-code the result),
  not an unresolved design question; everything else is exact code or exact commands.
- **Type consistency:** `listExecutable`/`transitionDecision(extras)`/`insertAgentRun` (Task 1)
  consumed by Tasks 11–12 via the routes; `logMessage`/`countRecentOutbound`/
  `getConsentStatus`/`getActivePrompt`/`CHANNELS` (Task 2) consumed by Tasks 3 and 12;
  `checkCompliance` verdicts `allow|defer|deny` (Task 3) match Task 12's branches;
  `ingestCandidate → { candidate_id, document_id, deduped }` (Task 4) matches Task 9's usage;
  `searchCandidatesByEmbedding`/`getJobOrder`/`getCandidateWithResume`/`insertScore` (Task 5)
  match Tasks 10–11; `parseScoreOutput` fields (Task 6) match Task 11's consumption
  (`agent_label`, `fit_percentage`, `c01_gate_fired`, `top_strengths`, `key_gaps`,
  `recommendation`); helper names in `helpers.js` (Task 7) match every workflow body; decision
  API response shape `{ decision }` (Plan 1a) matches `d.decision.id` in workflows.
- **Build-session verification points (flagged inline):** n8n image version and its pinned tag
  (custom workflow ids on `import:workflow`, `$env` + `require('crypto')` gating env vars,
  webhook `typeVersion`), Mailpit `POST /api/v1/send` availability, drizzle `numeric` string
  handling, `db.execute` row shape for postgres-js.
- **Prior-session finding, now fixed here:** the source Plan 1c document's Task 1 snippet would
  have silently dropped the ADR-0003 compare-and-swap guard already present in
  `src/services/decision-store.ts`. Task 1 Step 2 here extends the existing function instead of
  replacing it, and Step 1's new third test explicitly asserts the guard survives the `extras`
  change.
