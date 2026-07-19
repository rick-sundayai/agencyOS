# Agent Org Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `/api/agent/*` route uses the authenticated agent's own `org_id` (from `requireAgentKey`'s resolved `AgentIdentity`) instead of trusting a client-supplied `org_id`, closing the cross-org data access gap left open by [ADR-0005](../../adr/0005-per-agent-api-keys.md) and recorded in [ADR-0006](../../adr/0006-agent-org-scoping.md).

**Architecture:** Each route substitutes `auth.org_id` for the client-supplied `org_id` immediately after the existing `if (auth instanceof Response) return auth;` check, before calling any service function. Query-param routes drop their `org_id` read and required-check entirely (an authenticated request always has an org). Zod-body routes keep `org_id` in the schema for wire-format stability but override the parsed value before it reaches the service call. Service-layer function signatures are unchanged.

**Tech Stack:** Next.js 16 route handlers, Drizzle ORM over Postgres, Zod, Vitest.

## Global Constraints

- Assumes one org per agent for the lifetime of a key (confirmed during design — `agents.org_id` is a single non-nullable column, and each per-client "stamp" deployment has its own isolated `agents` table).
- Override, not reject: a client-supplied `org_id` that doesn't match `auth.org_id` is silently ignored, not rejected with an error. No new status codes are introduced.
- No wire-format changes: every route's client-facing request shape (query params, Zod body schemas) stays exactly as-is — `org_id` remains present in the shape, just never trusted for the actual DB-touching call.
- `src/app/api/agent/decisions/executable/route.ts`'s `org_id` query param is currently **optional** (omitting it lists executable decisions across all orgs, via `listExecutable`'s optional `opts.orgId`). This plan removes that capability — after this change, the route always resolves to exactly `auth.org_id`. This is intentional per the design's "one org per agent, always" assumption.
- Follow existing test conventions: Vitest, real Postgres connection (no mocks), no cleanup/`afterEach` (matches the whole existing `/api/agent/*` test suite's convention of accumulating test data).

---

### Task 1: `seedTestAgentInFreshOrg` test helper

**Files:**
- Modify: `src/test-support/seed-agent.ts`
- Create: `src/test-support/seed-agent.test.ts`

**Interfaces:**
- Produces: `seedTestAgentInFreshOrg(): Promise<{ orgId: string; key: string; name: string }>` — every later task's cross-org regression tests need two agents in two distinct orgs; `seedTestAgent()` always uses the shared `'Sunday AI Work'` org, so this new helper creates a brand-new, isolated org each call.

- [ ] **Step 1: Write the failing test**

```ts
// src/test-support/seed-agent.test.ts
import { describe, it, expect } from 'vitest';
import { requireAgentKey, type AgentIdentity } from '../lib/agent-auth';
import { seedTestAgent, seedTestAgentInFreshOrg } from './seed-agent';

function req(key: string): Request {
  return new Request('http://test/api/agent/x', { headers: { 'x-agent-api-key': key } });
}

describe('seedTestAgentInFreshOrg', () => {
  it('creates an agent scoped to a brand-new org, distinct from seedTestAgent\'s shared org', async () => {
    const shared = await seedTestAgent();
    const fresh = await seedTestAgentInFreshOrg();
    expect(fresh.orgId).not.toBe(shared.orgId);

    const result = await requireAgentKey(req(fresh.key));
    expect(result).not.toBeInstanceOf(Response);
    const identity = result as AgentIdentity;
    expect(identity.org_id).toBe(fresh.orgId);
    expect(identity.name).toBe(fresh.name);
  });

  it('produces a genuinely new org each call', async () => {
    const a = await seedTestAgentInFreshOrg();
    const b = await seedTestAgentInFreshOrg();
    expect(a.orgId).not.toBe(b.orgId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test-support/seed-agent.test.ts`
Expected: FAIL — `seedTestAgentInFreshOrg` is not exported yet.

- [ ] **Step 3: Add the helper**

```ts
// src/test-support/seed-agent.ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, orgs } from '../db/schema';
import { hashApiKey } from '../lib/agent-auth';

/** Inserts a fresh agent with a random plaintext key for tests. Not for production use. */
export async function seedTestAgent(): Promise<{ orgId: string; key: string; name: string }> {
  const [org] = await db.select().from(orgs).where(eq(orgs.name, 'Sunday AI Work'));
  const name = `test-agent-${randomUUID()}`;
  const key = randomUUID();
  await db.insert(agents).values({ org_id: org.id, name, api_key_hash: hashApiKey(key) });
  return { orgId: org.id, key, name };
}

/**
 * Inserts a fresh agent scoped to a brand-new, isolated org (not 'Sunday AI Work').
 * For org-scoping regression tests that need two distinct orgs — e.g. proving a
 * route ignores a client-supplied org_id and uses the authenticated agent's own org.
 */
export async function seedTestAgentInFreshOrg(): Promise<{ orgId: string; key: string; name: string }> {
  const [org] = await db.insert(orgs).values({ name: `test-org-${randomUUID()}` }).returning();
  const name = `test-agent-${randomUUID()}`;
  const key = randomUUID();
  await db.insert(agents).values({ org_id: org.id, name, api_key_hash: hashApiKey(key) });
  return { orgId: org.id, key, name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test-support/seed-agent.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/test-support/seed-agent.ts src/test-support/seed-agent.test.ts
git commit -m "feat: add seedTestAgentInFreshOrg helper for cross-org test isolation"
```

---

### Task 2: `decisions`, `decisions/executable`, and `runs` routes

**Files:**
- Modify: `src/app/api/agent/decisions/route.ts`
- Modify: `src/app/api/agent/decisions/route.test.ts`
- Modify: `src/app/api/agent/decisions/executable/route.ts`
- Modify: `src/app/api/agent/decisions/executable/route.test.ts`
- Modify: `src/app/api/agent/runs/route.ts`

**Interfaces:**
- Consumes: `seedTestAgentInFreshOrg` from Task 1.

These three routes are grouped because their tests already live in 2 existing files (`runs/route.ts`'s only test coverage is inside `decisions/executable/route.test.ts`'s "POST /api/agent/runs" block).

- [ ] **Step 1: Write the failing test changes**

In `src/app/api/agent/decisions/route.test.ts`, add the import and two new tests, and **remove** the now-obsolete "malformed org_id → 500" test (its premise — that a client-supplied `org_id` reaches `listQueue` — is exactly the vulnerability being fixed; once `org_id` is ignored, a malformed one in the query string can no longer cause a 500):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { seedTestAgent, seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST, GET } from './route';

let orgId: string;
let KEY: string;

beforeAll(async () => {
  ({ orgId, key: KEY } = await seedTestAgent());
});

function post(body: unknown, key = KEY) {
  return POST(new Request('http://test/api/agent/decisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

const validBody = () => ({
  org_id: orgId,
  agent: 'sourcing',
  action_class: 'source.shortlist',
  reasoning: { summary: 'top 10 by cosine', evidence: [], model: 'gemini-2.5-flash', prompt_version: 'v1' },
  payload: { candidate_ids: [] },
});

describe('POST /api/agent/decisions', () => {
  it('creates a decision and returns 201', async () => {
    const res = await post(validBody());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.decision.tier).toBe('1');
    expect(json.decision.state).toBe('approved');
  });

  it('returns 401 on a bad key', async () => {
    const res = await post(validBody(), 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns 400 with issues on invalid body', async () => {
    const res = await post({ agent: 'sourcing' });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(Array.isArray(json.issues)).toBe(true);
  });

  it('ignores a client-supplied org_id and scopes the decision to the authenticated agent\'s org', async () => {
    const other = await seedTestAgentInFreshOrg();
    const res = await post({ ...validBody(), org_id: other.orgId });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.decision.org_id).toBe(orgId);
  });
});

describe('GET /api/agent/decisions', () => {
  it('returns the queue for an org', async () => {
    const res = await GET(new Request(`http://test/api/agent/decisions?org_id=${orgId}`, {
      headers: { 'x-agent-api-key': KEY },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.queue)).toBe(true);
  });

  it('ignores a client-supplied org_id and returns the authenticated agent\'s own queue', async () => {
    const other = await seedTestAgentInFreshOrg();
    const posted = await post({ ...validBody(), action_class: 'client.submit_candidate' }); // tier 3 → proposed, appears in listQueue
    const { decision } = await posted.json();
    const res = await GET(new Request(`http://test/api/agent/decisions?org_id=${other.orgId}`, {
      headers: { 'x-agent-api-key': KEY },
    }));
    expect(res.status).toBe(200);
    const { queue } = await res.json();
    expect(queue.map((q: { id: string }) => q.id)).toContain(decision.id);
  });
});
```

In `src/app/api/agent/decisions/executable/route.test.ts`, add the import and two new tests (one for the `GET .../executable` block, one for the `POST /api/agent/runs` block):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../../../../../lib/env';
import { seedTestAgent, seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { proposeDecision } from '../../../../../services/decision-store';
import { GET } from './route';
import { POST as TRANSITION } from '../[id]/transition/route';
import { POST as RUNS } from '../../runs/route';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let KEY: string;
let orgId: string;
let AGENT_NAME: string;

beforeAll(async () => {
  ({ orgId, key: KEY, name: AGENT_NAME } = await seedTestAgent());
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

  it('ignores a client-supplied org_id and returns the authenticated agent\'s own executable queue', async () => {
    const other = await seedTestAgentInFreshOrg();
    const d = await proposeDecision(proposal());
    await sql`update decisions set undo_expires_at = now() - interval '1 minute' where id = ${d.id}`;
    const res = await GET(new Request(
      `http://t/api/agent/decisions/executable?org_id=${other.orgId}&action_prefix=comms.`,
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
    const r1 = await call(d.id, { to: 'executing' });
    expect(r1.status).toBe(200);
    const r2 = await call(d.id, { to: 'executed', outcome: { message_id: 'm1' } });
    const { decision } = await r2.json();
    expect(decision.state).toBe('executed');
    expect(decision.outcome).toEqual({ message_id: 'm1' });
  });

  it('409 on an illegal transition', async () => {
    const d = await proposeDecision(proposal());
    const res = await call(d.id, { to: 'undone' });
    expect(res.status).toBe(409);
  });

  it('409 (not 500) when a concurrent transition already moved the decision', async () => {
    const d = await proposeDecision(proposal()); // tier 2 → approved
    await Promise.all([proposeDecision(proposal()), proposeDecision(proposal())]);
    const [a, b] = await Promise.allSettled([
      call(d.id, { to: 'executing' }),
      call(d.id, { to: 'cancelled' }),
    ]);
    const responses = [a, b].map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean) as Response[];
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = responses.find((r) => r.status === 409)!;
    const body = await loser.json();
    expect(body.error).toMatch(/already transitioned by another process/);
  });

  it('stamps approved_by with the authenticated agent, not a client-supplied value', async () => {
    const proposeSchema = () => ({
      org_id: orgId, agent: 'client-account', action_class: 'client.submit_candidate',
      reasoning: { summary: 'route test', evidence: [], model: 'm', prompt_version: 'v' },
      payload: {},
    });
    const d = await proposeDecision(proposeSchema()); // tier 3 → proposed
    const res = await call(d.id, { to: 'approved' });
    expect(res.status).toBe(200);
    const { decision } = await res.json();
    expect(decision.approved_by).toBe(AGENT_NAME);
  });

  it('400s if the request body still tries to supply an actor field', async () => {
    const d = await proposeDecision(proposal());
    const res = await call(d.id, { to: 'executing', actor: 'spoofed-agent-name' });
    expect(res.status).toBe(400);
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

  it('ignores a client-supplied org_id and scopes the run to the authenticated agent\'s org', async () => {
    const other = await seedTestAgentInFreshOrg();
    const res = await RUNS(new Request('http://t/api/agent/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-api-key': KEY },
      body: JSON.stringify({ org_id: other.orgId, agent: 'sourcing', workflow: 'agencyos-sourcing', model: 'gemini-embedding-001' }),
    }));
    expect(res.status).toBe(201);
    const { run } = await res.json();
    expect(run.org_id).toBe(orgId);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/agent/decisions/route.test.ts src/app/api/agent/decisions/executable/route.test.ts`
Expected: FAIL — the new cross-org tests fail because the routes still trust the client-supplied `org_id`.

- [ ] **Step 3: Fix the three routes**

```ts
// src/app/api/agent/decisions/route.ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { proposeDecision, listQueue } from '../../../../services/decision-store';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    const decision = await proposeDecision({ ...body, org_id: auth.org_id });
    return Response.json({ decision }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    return Response.json({ queue: await listQueue(auth.org_id) });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

```ts
// src/app/api/agent/decisions/executable/route.ts
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { listExecutable } from '../../../../../services/decision-store';

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const queue = await listExecutable({
    orgId: auth.org_id,
    actionPrefix: url.searchParams.get('action_prefix') ?? undefined,
  });
  return Response.json({ queue });
}
```

```ts
// src/app/api/agent/runs/route.ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { insertAgentRun } from '../../../../services/agent-runs';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    const run = await insertAgentRun({ ...body, org_id: auth.org_id });
    return Response.json({ run }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/agent/decisions/route.test.ts src/app/api/agent/decisions/executable/route.test.ts`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agent/decisions/route.ts src/app/api/agent/decisions/route.test.ts src/app/api/agent/decisions/executable/route.ts src/app/api/agent/decisions/executable/route.test.ts src/app/api/agent/runs/route.ts
git commit -m "fix: scope decisions, executable, and runs routes to the authenticated agent's org"
```

---

### Task 3: Query-param GET routes without existing tests — `candidates/[id]`, `consents`, `job-orders/[id]`, `prompts`

**Files:**
- Modify: `src/app/api/agent/candidates/[id]/route.ts`
- Create: `src/app/api/agent/candidates/[id]/route.test.ts`
- Modify: `src/app/api/agent/consents/route.ts`
- Create: `src/app/api/agent/consents/route.test.ts`
- Modify: `src/app/api/agent/job-orders/[id]/route.ts`
- Create: `src/app/api/agent/job-orders/[id]/route.test.ts`
- Modify: `src/app/api/agent/prompts/route.ts`
- Create: `src/app/api/agent/prompts/route.test.ts`

**Interfaces:**
- Consumes: `seedTestAgentInFreshOrg` from Task 1.

Each of these had `if (!orgId) return Response.json({ error: '... required' }, { status: 400 })` covering `org_id` alongside other required params — that check now drops the `org_id` clause but keeps checking its other required params.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/agent/candidates/[id]/route.test.ts
import { describe, it, expect } from 'vitest';
import { db } from '../../../../../db/client';
import { candidates } from '../../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { GET } from './route';

function get(id: string, orgId: string, key: string) {
  return GET(new Request(`http://test/api/agent/candidates/${id}?org_id=${orgId}`, {
    headers: { 'x-agent-api-key': key },
  }), { params: Promise.resolve({ id }) });
}

describe('GET /api/agent/candidates/:id', () => {
  it('401s without a key', async () => {
    const res = await GET(new Request('http://test/api/agent/candidates/x'), { params: Promise.resolve({ id: 'x' }) });
    expect(res.status).toBe(401);
  });

  it('returns the candidate scoped to the authenticated agent\'s org, ignoring a client-supplied org_id from another org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Test Candidate' })
      .returning();

    const res = await get(candidate.id, other.orgId, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.candidate.id).toBe(candidate.id);
  });

  it('404s when the candidate belongs to a different org than the authenticated agent', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const requester = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Other Org Candidate' })
      .returning();

    const res = await get(candidate.id, owner.orgId, requester.key);
    expect(res.status).toBe(404);
  });
});
```

```ts
// src/app/api/agent/consents/route.test.ts
import { describe, it, expect } from 'vitest';
import { db } from '../../../../db/client';
import { candidates, consents } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { GET } from './route';

function get(params: string, key: string) {
  return GET(new Request(`http://test/api/agent/consents?${params}`, {
    headers: { 'x-agent-api-key': key },
  }));
}

describe('GET /api/agent/consents', () => {
  it('401s without a key', async () => {
    const res = await GET(new Request('http://test/api/agent/consents'));
    expect(res.status).toBe(401);
  });

  it('scopes to the authenticated agent\'s org, ignoring a client-supplied org_id from another org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Consent Candidate' })
      .returning();
    await db.insert(consents).values({
      org_id: owner.orgId, candidate_id: candidate.id, channel: 'email', status: 'granted',
    });

    const res = await get(`org_id=${other.orgId}&candidate_id=${candidate.id}&channel=email`, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('granted');
  });

  it('returns unknown (not another org\'s consent) when the consent belongs to a different org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const requester = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Isolated Candidate' })
      .returning();
    await db.insert(consents).values({
      org_id: owner.orgId, candidate_id: candidate.id, channel: 'sms', status: 'granted',
    });

    const res = await get(`org_id=${owner.orgId}&candidate_id=${candidate.id}&channel=sms`, requester.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('unknown');
  });
});
```

```ts
// src/app/api/agent/job-orders/[id]/route.test.ts
import { describe, it, expect } from 'vitest';
import { db } from '../../../../../db/client';
import { job_orders } from '../../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { GET } from './route';

function get(id: string, orgId: string, key: string) {
  return GET(new Request(`http://test/api/agent/job-orders/${id}?org_id=${orgId}`, {
    headers: { 'x-agent-api-key': key },
  }), { params: Promise.resolve({ id }) });
}

describe('GET /api/agent/job-orders/:id', () => {
  it('401s without a key', async () => {
    const res = await GET(new Request('http://test/api/agent/job-orders/x'), { params: Promise.resolve({ id: 'x' }) });
    expect(res.status).toBe(401);
  });

  it('returns the job order scoped to the authenticated agent\'s org, ignoring a client-supplied org_id from another org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [jobOrder] = await db.insert(job_orders)
      .values({ org_id: owner.orgId, title: 'Test Role', kind: 'direct_hire' })
      .returning();

    const res = await get(jobOrder.id, other.orgId, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.job_order.id).toBe(jobOrder.id);
  });

  it('404s when the job order belongs to a different org than the authenticated agent', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const requester = await seedTestAgentInFreshOrg();
    const [jobOrder] = await db.insert(job_orders)
      .values({ org_id: owner.orgId, title: 'Other Org Role', kind: 'contract' })
      .returning();

    const res = await get(jobOrder.id, owner.orgId, requester.key);
    expect(res.status).toBe(404);
  });
});
```

```ts
// src/app/api/agent/prompts/route.test.ts
import { describe, it, expect } from 'vitest';
import { db } from '../../../../db/client';
import { system_prompts } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { GET } from './route';

function get(params: string, key: string) {
  return GET(new Request(`http://test/api/agent/prompts?${params}`, {
    headers: { 'x-agent-api-key': key },
  }));
}

describe('GET /api/agent/prompts', () => {
  it('401s without a key', async () => {
    const res = await GET(new Request('http://test/api/agent/prompts'));
    expect(res.status).toBe(401);
  });

  it('returns the active prompt scoped to the authenticated agent\'s org, ignoring a client-supplied org_id from another org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    await db.insert(system_prompts).values({
      org_id: owner.orgId, agent: 'screening', name: 'resume-scorer',
      version: 'v1', body: 'test prompt body', active: true,
    });

    const res = await get(`org_id=${other.orgId}&agent=screening&name=resume-scorer`, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.prompt.body).toBe('test prompt body');
  });

  it('404s when the active prompt belongs to a different org than the authenticated agent', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const requester = await seedTestAgentInFreshOrg();
    await db.insert(system_prompts).values({
      org_id: owner.orgId, agent: 'screening', name: 'resume-scorer',
      version: 'v1', body: 'other org prompt', active: true,
    });

    const res = await get(`org_id=${owner.orgId}&agent=screening&name=resume-scorer`, requester.key);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/agent/candidates/\[id\]/route.test.ts src/app/api/agent/consents/route.test.ts src/app/api/agent/job-orders/\[id\]/route.test.ts src/app/api/agent/prompts/route.test.ts`
Expected: FAIL — 401 tests pass (no route changes needed there), but the org-scoping tests fail since the routes still read `org_id` from the query string.

- [ ] **Step 3: Fix the four routes**

```ts
// src/app/api/agent/candidates/[id]/route.ts
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { getCandidateWithResume } from '../../../../../services/matching';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  try {
    const result = await getCandidateWithResume(auth.org_id, id);
    if (!result) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

```ts
// src/app/api/agent/consents/route.ts
import { requireAgentKey } from '../../../../lib/agent-auth';
import { getConsentStatus, CHANNELS, type Channel } from '../../../../services/comms-log';

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const candidateId = url.searchParams.get('candidate_id');
  const channel = url.searchParams.get('channel') as Channel | null;
  if (!candidateId || !channel || !CHANNELS.includes(channel)) {
    return Response.json({ error: 'candidate_id, channel required' }, { status: 400 });
  }
  return Response.json({ status: await getConsentStatus(auth.org_id, candidateId, channel) });
}
```

```ts
// src/app/api/agent/job-orders/[id]/route.ts
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { getJobOrder } from '../../../../../services/matching';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  try {
    const job_order = await getJobOrder(auth.org_id, id);
    if (!job_order) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ job_order });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

```ts
// src/app/api/agent/prompts/route.ts
import { requireAgentKey } from '../../../../lib/agent-auth';
import { getActivePrompt } from '../../../../services/comms-log';

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const agent = url.searchParams.get('agent');
  const name = url.searchParams.get('name');
  if (!agent || !name) {
    return Response.json({ error: 'agent, name required' }, { status: 400 });
  }
  const prompt = await getActivePrompt(auth.org_id, agent, name);
  if (!prompt) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ prompt });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/agent/candidates/\[id\]/route.test.ts src/app/api/agent/consents/route.test.ts src/app/api/agent/job-orders/\[id\]/route.test.ts src/app/api/agent/prompts/route.test.ts`
Expected: PASS (2 tests each for candidates/[id] and job-orders/[id]; 3 tests each for consents and prompts — 10 total).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agent/candidates/\[id\]/route.ts src/app/api/agent/candidates/\[id\]/route.test.ts src/app/api/agent/consents/route.ts src/app/api/agent/consents/route.test.ts src/app/api/agent/job-orders/\[id\]/route.ts src/app/api/agent/job-orders/\[id\]/route.test.ts src/app/api/agent/prompts/route.ts src/app/api/agent/prompts/route.test.ts
git commit -m "fix: scope candidates/:id, consents, job-orders/:id, prompts routes to the authenticated agent's org"
```

---

### Task 4: Zod-body POST routes without existing tests — `messages`, `candidates`, `search/candidates`

**Files:**
- Modify: `src/app/api/agent/messages/route.ts`
- Create: `src/app/api/agent/messages/route.test.ts`
- Modify: `src/app/api/agent/candidates/route.ts`
- Create: `src/app/api/agent/candidates/route.test.ts`
- Modify: `src/app/api/agent/search/candidates/route.ts`
- Create: `src/app/api/agent/search/candidates/route.test.ts`

**Interfaces:**
- Consumes: `seedTestAgentInFreshOrg` from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/agent/messages/route.test.ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { candidates, conversations } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/messages', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/messages', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and logs under the authenticated agent\'s org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Message Candidate' })
      .returning();

    const res = await post({
      org_id: other.orgId, candidate_id: candidate.id, channel: 'email',
      direction: 'outbound', body: 'hello',
    }, owner.key);
    expect(res.status).toBe(201);
    const json = await res.json();
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, json.conversation_id));
    expect(conv.org_id).toBe(owner.orgId);
  });
});
```

```ts
// src/app/api/agent/candidates/route.test.ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { candidates } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/candidates', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/candidates', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and ingests under the authenticated agent\'s org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();

    const res = await post({
      org_id: other.orgId, full_name: 'Ingested Candidate', email: `ingest-${Date.now()}@example.com`,
    }, owner.key);
    expect(res.status).toBe(201);
    const json = await res.json();
    const [candidate] = await db.select().from(candidates).where(eq(candidates.id, json.candidate_id));
    expect(candidate.org_id).toBe(owner.orgId);
  });
});
```

```ts
// src/app/api/agent/search/candidates/route.test.ts
import { describe, it, expect } from 'vitest';
import { db } from '../../../../../db/client';
import { candidates, candidate_documents, embeddings } from '../../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { POST } from './route';

const VEC = new Array(3072).fill(0);

async function seedSearchableCandidate(orgId: string, fullName: string) {
  const [candidate] = await db.insert(candidates).values({ org_id: orgId, full_name: fullName }).returning();
  const [doc] = await db.insert(candidate_documents).values({
    org_id: orgId, candidate_id: candidate.id, kind: 'resume', storage_key: `test/${candidate.id}.txt`,
  }).returning();
  await db.insert(embeddings).values({
    org_id: orgId, subject_type: 'candidate_document', subject_id: doc.id,
    chunk_index: 0, content: 'test content', embedding: VEC, content_hash: 'hash',
  });
  return candidate;
}

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/search/candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/search/candidates', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/search/candidates', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and searches only the authenticated agent\'s own org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const ownCandidate = await seedSearchableCandidate(owner.orgId, 'Own Org Candidate');
    const otherCandidate = await seedSearchableCandidate(other.orgId, 'Other Org Candidate');

    const res = await post({ org_id: other.orgId, query_embedding: VEC, limit: 10 }, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    const ids = json.results.map((r: { candidate_id: string }) => r.candidate_id);
    expect(ids).toContain(ownCandidate.id);
    expect(ids).not.toContain(otherCandidate.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/agent/messages/route.test.ts src/app/api/agent/candidates/route.test.ts src/app/api/agent/search/candidates/route.test.ts`
Expected: FAIL — the org-scoping tests fail since the routes still trust the client-supplied `org_id` in the body.

- [ ] **Step 3: Fix the three routes**

```ts
// src/app/api/agent/messages/route.ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { logMessage } from '../../../../services/comms-log';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    return Response.json(await logMessage({ ...body, org_id: auth.org_id }), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

```ts
// src/app/api/agent/candidates/route.ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { ingestCandidate } from '../../../../services/ingest';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    return Response.json(await ingestCandidate({ ...body, org_id: auth.org_id }), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

```ts
// src/app/api/agent/search/candidates/route.ts
import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { searchCandidatesByEmbedding } from '../../../../../services/matching';

const SearchSchema = z.strictObject({
  org_id: z.uuid(),
  query_embedding: z.array(z.number()).length(3072),
  limit: z.number().int().min(1).max(100).default(10),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const p = SearchSchema.parse(await req.json());
    const results = await searchCandidatesByEmbedding(auth.org_id, p.query_embedding, p.limit);
    return Response.json({ results });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

(`SearchSchema` keeps `org_id` in its shape for wire-format stability — `p.org_id` is simply never read; `auth.org_id` is used directly.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/agent/messages/route.test.ts src/app/api/agent/candidates/route.test.ts src/app/api/agent/search/candidates/route.test.ts`
Expected: PASS (2 tests each, 6 total).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agent/messages/route.ts src/app/api/agent/messages/route.test.ts src/app/api/agent/candidates/route.ts src/app/api/agent/candidates/route.test.ts src/app/api/agent/search/candidates/route.ts src/app/api/agent/search/candidates/route.test.ts
git commit -m "fix: scope messages, candidates, search/candidates routes to the authenticated agent's org"
```

---

### Task 5: Zod-body POST routes without existing tests — `compliance/check`, `embeddings`, `scores`

**Files:**
- Modify: `src/app/api/agent/compliance/check/route.ts`
- Create: `src/app/api/agent/compliance/check/route.test.ts`
- Modify: `src/app/api/agent/embeddings/route.ts`
- Create: `src/app/api/agent/embeddings/route.test.ts`
- Modify: `src/app/api/agent/scores/route.ts`
- Create: `src/app/api/agent/scores/route.test.ts`

**Interfaces:**
- Consumes: `seedTestAgentInFreshOrg` from Task 1.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/agent/compliance/check/route.test.ts
import { describe, it, expect } from 'vitest';
import { db } from '../../../../../db/client';
import { candidates, consents } from '../../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/compliance/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/compliance/check', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/compliance/check', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id: a revoked consent in another org does not leak into the authenticated agent\'s own org verdict', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: other.orgId, full_name: 'Revoked Elsewhere' })
      .returning();
    await db.insert(consents).values({
      org_id: other.orgId, candidate_id: candidate.id, channel: 'email', status: 'revoked',
    });

    const res = await post({ org_id: other.orgId, candidate_id: candidate.id, channel: 'email' }, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reasons).not.toContain('consent_revoked');
  });
});
```

```ts
// src/app/api/agent/embeddings/route.test.ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { embeddings } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST } from './route';

const VEC = new Array(3072).fill(0);

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/embeddings', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/embeddings', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and writes under the authenticated agent\'s own org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const subjectId = randomUUID();

    const res = await post({
      org_id: other.orgId, subject_type: 'job_order', subject_id: subjectId,
      chunks: [{ chunk_index: 0, content: 'text', embedding: VEC, content_hash: 'hash' }],
    }, owner.key);
    expect(res.status).toBe(201);

    const rows = await db.select().from(embeddings).where(
      and(eq(embeddings.subject_id, subjectId), eq(embeddings.org_id, owner.orgId)),
    );
    expect(rows).toHaveLength(1);
  });
});
```

```ts
// src/app/api/agent/scores/route.test.ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { candidates, job_orders, scores } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/scores', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/scores', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and records the score under the authenticated agent\'s own org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [jobOrder] = await db.insert(job_orders)
      .values({ org_id: owner.orgId, title: 'Scoring Role', kind: 'direct_hire' }).returning();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Scored Candidate' }).returning();

    const res = await post({
      org_id: other.orgId, job_order_id: jobOrder.id, candidate_id: candidate.id,
      prompt_version: 'v1', model: 'gemini-2.5-flash', fit_rating: 'yes',
    }, owner.key);
    expect(res.status).toBe(201);
    const json = await res.json();
    const [row] = await db.select().from(scores).where(eq(scores.id, json.score.id));
    expect(row.org_id).toBe(owner.orgId);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/agent/compliance/check/route.test.ts src/app/api/agent/embeddings/route.test.ts src/app/api/agent/scores/route.test.ts`
Expected: FAIL — the org-scoping tests fail since the routes still trust the client-supplied `org_id` in the body.

- [ ] **Step 3: Fix the three routes**

```ts
// src/app/api/agent/compliance/check/route.ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { checkCompliance } from '../../../../../services/compliance';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    return Response.json(await checkCompliance({ ...body, org_id: auth.org_id }));
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

```ts
// src/app/api/agent/embeddings/route.ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { upsertEmbeddings } from '../../../../services/ingest';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    return Response.json(await upsertEmbeddings({ ...body, org_id: auth.org_id }), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

```ts
// src/app/api/agent/scores/route.ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { insertScore } from '../../../../services/matching';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    return Response.json({ score: await insertScore({ ...body, org_id: auth.org_id }) }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/agent/compliance/check/route.test.ts src/app/api/agent/embeddings/route.test.ts src/app/api/agent/scores/route.test.ts`
Expected: PASS (2 tests each, 6 total).

Then run the full suite once:

Run: `npm test`
Expected: all tests across the whole repo pass (it's fine/expected if `scripts/migration/backfill-embeddings.test.ts` occasionally flakes — known pre-existing issue, unrelated to this work).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agent/compliance/check/route.ts src/app/api/agent/compliance/check/route.test.ts src/app/api/agent/embeddings/route.ts src/app/api/agent/embeddings/route.test.ts src/app/api/agent/scores/route.ts src/app/api/agent/scores/route.test.ts
git commit -m "fix: scope compliance/check, embeddings, scores routes to the authenticated agent's org"
```
