# Decision-Transition Org Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the cross-org authorization gap in `transitionDecision` — the only decision-mutating function with no `org_id` check — for both of its callers: the agent API route and the human dashboard's server actions.

**Architecture:** Add a required `orgId` parameter to `transitionDecision` (`src/services/decision-store.ts`) and filter both its lookup and its compare-and-swap update by that org. Both call sites already have an authenticated org available (`auth.org_id` from `requireAgentKey` on the agent side, `session.user.org_id` from NextAuth on the human side) — this plan threads it through. An org mismatch throws the same "not found" error already used for a genuinely missing decision, so a wrong-org caller can't distinguish the two cases.

**Tech Stack:** Next.js 16 route handlers and server actions, Drizzle ORM over Postgres, Zod, Vitest with a real Postgres connection (no mocks).

## Global Constraints

- `transitionDecision`'s new `orgId` parameter is **required**, not optional — every caller must supply it. Signature becomes `transitionDecision(id: string, to: DecisionState, actor: string, orgId: string, extras?: { error?: string | null; outcome?: unknown })`.
- On an org mismatch, throw the exact same message already thrown for a missing row: `` `Decision not found: ${id}` ``. Do not introduce a distinct message, a new exception type, or a new HTTP status code anywhere in this plan.
- No other callers of `transitionDecision` exist besides the agent transition route and `src/app/queue-actions.ts` (confirmed by grep during design) — no other call sites need updating.
- Every new/changed test must seed real rows via existing helpers (`seedTestAgentInFreshOrg` from `src/test-support/seed-agent.ts`, or raw `orgs`/`users` inserts matching `src/app/queue-actions.test.ts`'s existing pattern) — this codebase's test convention is real Postgres, never mocks for data access.

---

### Task 1: `transitionDecision` takes and enforces `orgId`

**Files:**
- Modify: `src/services/decision-store.ts:47-84` (the `transitionDecision` function)
- Test: create `src/app/api/agent/decisions/[id]/transition/route.test.ts` (does not exist yet — this task adds the first tests for the transition route, covering both the pre-existing behavior and the new org check)

**Interfaces:**
- Consumes: `db` from `../db/client`; `decisions` from `../db/schema`; `and`/`eq` from `drizzle-orm` (all already imported in this file).
- Produces: `transitionDecision(id: string, to: DecisionState, actor: string, orgId: string, extras?: { error?: string | null; outcome?: unknown }): Promise<DecisionRow>` — the new signature every later task's callers use. Throws `` `Decision not found: ${id}` `` (Error) both when no row matches `id` at all and when a row matches `id` but its `org_id !== orgId`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/agent/decisions/[id]/transition/route.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { seedTestAgent, seedTestAgentInFreshOrg } from '../../../../../../test-support/seed-agent';
import { proposeDecision, getDecision } from '../../../../../../services/decision-store';
import { POST } from './route';

let orgId: string;
let KEY: string;
let AGENT_NAME: string;

beforeAll(async () => {
  ({ orgId, key: KEY, name: AGENT_NAME } = await seedTestAgent());
});

function post(id: string, body: unknown, key = KEY) {
  return POST(
    new Request(`http://test/api/agent/decisions/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const tier3Proposal = (org = orgId) => ({
  org_id: org,
  agent: 'placement',
  action_class: 'client.submit_candidate',
  reasoning: { summary: 'ready to submit', evidence: [], model: 'claude', prompt_version: 'v1' },
  payload: {},
});

describe('POST /api/agent/decisions/[id]/transition', () => {
  it('transitions a proposed decision to approved', async () => {
    const d = await proposeDecision(tier3Proposal());
    const res = await post(d.id, { to: 'approved' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.decision.state).toBe('approved');
    expect(json.decision.approved_by).toBe(AGENT_NAME);
  });

  it('returns 401 on a bad key', async () => {
    const d = await proposeDecision(tier3Proposal());
    const res = await post(d.id, { to: 'approved' }, 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a decision that does not exist', async () => {
    const res = await post('00000000-0000-0000-0000-000000000000', { to: 'approved' });
    expect(res.status).toBe(404);
  });

  it('returns 404 (not the decision) when the authenticated agent belongs to a different org', async () => {
    const other = await seedTestAgentInFreshOrg();
    const d = await proposeDecision(tier3Proposal());
    const res = await post(d.id, { to: 'approved' }, other.key);
    expect(res.status).toBe(404);
    const unchanged = await getDecision(d.id);
    expect(unchanged?.state).toBe('proposed');
  });
});
```

- [ ] **Step 2: Run tests to verify the new cross-org test fails, others pass**

Run: `npx vitest run src/app/api/agent/decisions/\[id\]/transition/route.test.ts`
Expected: 3 tests pass (transition, 401, 404-missing); the cross-org test fails — the route currently calls `transitionDecision(id, body.to, auth.name, {...})` with no `orgId` argument, so a cross-org agent's request succeeds (200, wrong state) instead of 404.

- [ ] **Step 3: Add `orgId` to `transitionDecision` and enforce it**

In `src/services/decision-store.ts`, replace the current `transitionDecision` function (lines 47-84):

```typescript
export async function transitionDecision(
  id: string,
  to: DecisionState,
  actor: string,
  orgId: string,
  extras: { error?: string | null; outcome?: unknown } = {},
): Promise<DecisionRow> {
  const [current] = await db.select().from(decisions)
    .where(and(eq(decisions.id, id), eq(decisions.org_id, orgId)));
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

  // Compare-and-swap on state (and org, for the same reason): guards against a concurrent
  // transition (e.g. Plan 1c's executor and a human Undo click racing on the same row)
  // silently overwriting each other. Whichever caller loses the race gets a thrown error
  // instead of a lost update (ADR-0003).
  const [row] = await db.update(decisions).set(patch)
    .where(and(eq(decisions.id, id), eq(decisions.org_id, orgId), eq(decisions.state, from)))
    .returning();
  if (!row) {
    throw new Error(`Decision ${id} was already transitioned by another process (expected state ${from})`);
  }
  return row;
}
```

This is a drop-in replacement — only the new `orgId` parameter and its two `eq(decisions.org_id, orgId)` filter clauses are new; every other line is unchanged from the current implementation.

- [ ] **Step 4: Update the agent route to pass `auth.org_id`**

In `src/app/api/agent/decisions/[id]/transition/route.ts`, change line 21-23 from:

```typescript
    const decision = await transitionDecision(id, body.to, auth.name, {
      error: body.error, outcome: body.outcome,
    });
```

to:

```typescript
    const decision = await transitionDecision(id, body.to, auth.name, auth.org_id, {
      error: body.error, outcome: body.outcome,
    });
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `npx vitest run src/app/api/agent/decisions/\[id\]/transition/route.test.ts`
Expected: PASS (4/4) — all four tests, including the cross-org one, now pass.

- [ ] **Step 6: Run the full suite to check for regressions from the signature change**

Run: `npm test`
Expected: `src/app/queue-actions.ts` and `src/app/queue-actions.test.ts` will now fail to compile/run — `transitionOrFriendlyError` calls `transitionDecision(id, to, actor)` with only 3 arguments, missing the new required `orgId`. This is expected and is fixed in Task 2, not here. Confirm no *other* file breaks.

- [ ] **Step 7: Commit**

```bash
git add src/services/decision-store.ts src/app/api/agent/decisions/\[id\]/transition/route.ts src/app/api/agent/decisions/\[id\]/transition/route.test.ts
git commit -m "fix: transitionDecision requires and enforces orgId, closing the agent-route cross-org gap"
```

---

### Task 2: `queue-actions.ts` passes and enforces `orgId`

**Files:**
- Modify: `src/app/queue-actions.ts` (all of it — `requireCanAct`, `transitionOrFriendlyError`, `approveDecisionAction`, `cancelDecisionAction`)
- Test: modify `src/app/queue-actions.test.ts` (add one new test to the existing `role-based authorization` describe block, or a new describe block)

**Interfaces:**
- Consumes: `transitionDecision(id, to, actor, orgId, extras?)` from Task 1 — the required 4th parameter.
- Produces: no new exports; `approveDecisionAction`/`cancelDecisionAction` keep their existing signatures (`(id: string) => Promise<DecisionRow>`) and existing thrown-error contract (`'Unauthorized'`, `'Forbidden — your role cannot act on this tier.'`, `` `Decision not found: ${id}` ``, `'This decision was already handled — refresh the queue.'`) — this task adds one more case to the existing "not found" message, it does not add a new one.

- [ ] **Step 1: Write the failing test**

In `src/app/queue-actions.test.ts`, add this test inside the existing `describe('role-based authorization', ...)` block (after the last existing `it`, before the closing `});`):

```typescript
  it('a session in a different org cannot act on the decision — same "not found" as a missing one', async () => {
    const otherOrg = (await sql`insert into orgs (name) values (${'qa-other-org-' + Date.now()}) returning id`)[0].id;
    const otherUserId = (await sql`
      insert into users (org_id, email, full_name, role) values
      (${otherOrg}, ${'qa-other-' + Date.now() + '@example.com'}, 'QA Other', 'admin') returning id`)[0].id;
    vi.mocked(auth).mockResolvedValue({
      user: { id: otherUserId, org_id: otherOrg, role: 'admin' },
      expires: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const d = await proposeDecision(tier3Proposal());
    await expect(approveDecisionAction(d.id)).rejects.toThrow(`Decision not found: ${d.id}`);
    const unchanged = await getDecision(d.id);
    expect(unchanged?.state).toBe('proposed');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/queue-actions.test.ts`
Expected: this new test FAILS (the cross-org call currently succeeds, since neither `requireCanAct` nor `transitionDecision` checks org — and the whole file also fails to run yet, from Task 1's signature change leaving `transitionOrFriendlyError`'s call uncompilable; that's expected until Step 3 below).

- [ ] **Step 3: Thread `orgId` through `requireCanAct` and both actions**

Replace the full contents of `src/app/queue-actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '../lib/auth';
import { canActOnTier, type Tier } from '../contracts/decision';
import { getCurrentRole } from '../lib/credentials';
import { transitionDecision, getDecision, type DecisionRow } from '../services/decision-store';

// Checks the session AND that the role may act on this decision's actual tier (ADR-0004) —
// not the tier the client claims, the one currently on the row. Role comes from a fresh DB
// read (getCurrentRole), not session.user.role: the JWT claim is cached at login and can be
// stale for the session's whole lifetime (next-auth default maxAge is 30 days) — a role
// revoked in the database must block the very next action, not wait for the next login.
//
// Also checks the decision's org_id against the session's org (ADR-0007) — same "not found"
// message as a genuinely missing decision, so a cross-org session can't distinguish the two.
async function requireCanAct(id: string): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  const decision = await getDecision(id);
  if (!decision) throw new Error(`Decision not found: ${id}`);
  if (decision.org_id !== session.user.org_id) throw new Error(`Decision not found: ${id}`);
  const role = await getCurrentRole(session.user.id);
  // decisions.tier is a plain text column (no DB enum) — cast to the contract's literal union,
  // same convention used for `state` in decision-store.ts (`current.state as DecisionState`).
  if (!role || !canActOnTier(role, decision.tier as Tier)) {
    throw new Error('Forbidden — your role cannot act on this tier.');
  }
  return { userId: session.user.id, orgId: session.user.org_id };
}

// transitionDecision throws this when it loses the compare-and-swap race on decisions.state
// (ADR-0003) — e.g. a human clicks Undo the same moment Plan 1c's executor picks the
// decision up. Surface a friendly message instead of the raw "already transitioned" error.
async function transitionOrFriendlyError(
  id: string, to: 'approved' | 'cancelled', actor: string, orgId: string,
): Promise<DecisionRow> {
  try {
    return await transitionDecision(id, to, actor, orgId);
  } catch (err) {
    if (err instanceof Error && err.message.includes('already transitioned by another process')) {
      throw new Error('This decision was already handled — refresh the queue.');
    }
    throw err;
  }
}

export async function approveDecisionAction(id: string): Promise<DecisionRow> {
  const { userId, orgId } = await requireCanAct(id);
  const row = await transitionOrFriendlyError(id, 'approved', userId, orgId);
  revalidatePath('/');
  return row;
}

export async function cancelDecisionAction(id: string): Promise<DecisionRow> {
  const { userId, orgId } = await requireCanAct(id);
  const row = await transitionOrFriendlyError(id, 'cancelled', userId, orgId);
  revalidatePath('/');
  return row;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/app/queue-actions.test.ts`
Expected: PASS — all existing tests in the file plus the new cross-org test.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions anywhere (one known pre-existing flake may appear in `scripts/migration/backfill-embeddings.test.ts` — unrelated to this work, confirmed in prior sessions to pass in isolation; do not treat it as a regression from this task).

- [ ] **Step 6: Commit**

```bash
git add src/app/queue-actions.ts src/app/queue-actions.test.ts
git commit -m "fix: queue-actions enforces session org against the decision's org"
```

---

### Task 3: Document the decision as ADR-0007

**Files:**
- Create: `docs/adr/0007-transition-org-scoping.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by other tasks — this is the last task.

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0007-transition-org-scoping.md`:

```markdown
# 0007: Require and enforce org_id in transitionDecision

**Date:** 2026-07-19
**Status:** Accepted

## Context

[ADR-0006](0006-agent-org-scoping.md) scoped all 14 `/api/agent/*` routes that read or write decisions to the authenticated agent's `auth.org_id`, closing a cross-org data access gap. One route was explicitly excluded from that work: the decision-transition route (`src/app/api/agent/decisions/[id]/transition/route.ts`). It identifies its target purely by the decision's UUID path segment, taking no `org_id` at all, so ADR-0006's "override the client-supplied org_id" pattern didn't apply.

That exclusion left `transitionDecision` (`src/services/decision-store.ts`) with no `org_id` check anywhere in its lookup or update — an agent authenticated for org A that obtained org B's decision UUID by any means could transition org B's decision. Nothing else compensated: `src/middleware.ts` excludes `/api/agent/*` from session-auth entirely, and no Postgres row-level security exists in this codebase.

Investigation also found a second, structurally identical caller: `src/app/queue-actions.ts`'s `requireCanAct`, used by the human-facing dashboard's `approveDecisionAction`/`cancelDecisionAction` server actions. It checks the session and the caller's role/tier against the decision, but never checked the decision's `org_id` against `session.user.org_id` — despite the dashboard's own listing (`src/app/page.tsx`) already scoping to `session.user.org_id`, confirming that boundary is the established org scope for human users too.

Practical exploitability was low in both cases — `decisions.id` is an unguessable `gen_random_uuid()`, and every legitimate listing path (agent or human) is already org-scoped — but the gap directly contradicted the trust model ADR-0006 established, and a future leak elsewhere (logs, a bug, a webhook payload) would have made it exploitable.

## Decision

`transitionDecision` now takes a required `orgId: string` parameter and filters both its `SELECT` and its compare-and-swap `UPDATE` by `org_id`. On a mismatch, it throws the exact same `` `Decision not found: ${id}` `` message already used for a row that doesn't exist at all — a wrong-org caller cannot distinguish "this decision doesn't exist" from "this decision exists, but not in your org." No new error message, exception type, or HTTP status code was introduced.

Both callers were updated together, since this is the same defect reached through two doors:
- The agent route passes `auth.org_id`, already resolved by its existing `requireAgentKey` call.
- `queue-actions.ts`'s `requireCanAct` gained an org check (`decision.org_id !== session.user.org_id` throws the same not-found message) and now returns `orgId` alongside `userId`, threaded through to `transitionDecision`.

We chose a required parameter over an optional one specifically to force every caller to supply an org — an optional `orgId` that silently skips the check when omitted would have left the human-dashboard path unfixed by default, defeating the purpose of the change.

## Consequences

**Positive:**
- Closes the last unscoped mutation path on the `decisions` table — every read, list, and write is now org-scoped by an authenticated identity, matching ADR-0006's trust model.
- Fixes the gap on both the agent API and the human dashboard in one coherent change, rather than leaving one half-patched.

**Negative / trade-offs:**
- A cross-org attempt (from either caller) now surfaces as "not found" rather than any more specific signal — consistent with ADR-0006's precedent, but it means a legitimately misconfigured caller (e.g. a bug passing the wrong decision ID) gets the same generic message as an authorization failure, which could be marginally harder to debug from the caller's side.
- `transitionDecision`'s signature is now a required 4-argument (plus optional 5th) function; any future caller must supply an org, which is the intended friction but is a small ergonomic cost.

**Neutral:**
- This is the last of the three ADRs (0005, 0006, 0007) closing gaps opened by the original shared-API-key model; no further known gaps in the `/api/agent/*` or decision-mutation surface remain as of this writing.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0007-transition-org-scoping.md
git commit -m "docs: add ADR-0007 for transition-route org scoping"
```
