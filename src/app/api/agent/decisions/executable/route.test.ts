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
    // Warm the shared db client's connection pool first (same rationale as
    // decision-store.test.ts's CAS race test): with a cold pool, the first call's
    // select+update round-trips complete before the second call's select even resolves, so
    // there's never any real contention to reject. Racing on already-open connections lets
    // both selects land before either update, which is what actually exercises the CAS guard.
    await Promise.all([proposeDecision(proposal()), proposeDecision(proposal())]);
    // Both 'executing' and 'cancelled' are valid next states from 'approved' — this isn't
    // an illegal-transition 409, it's the ADR-0003 compare-and-swap race guard.
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
