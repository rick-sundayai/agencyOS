import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { proposeDecision, transitionDecision, listQueue, getDecision, listExecutable } from './decision-store';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

function proposal(action_class: string) {
  return {
    org_id: orgId,
    agent: 'screening',
    action_class,
    reasoning: { summary: 'test', evidence: [], model: 'gemini-2.5-flash', prompt_version: 'v2.2.0' },
    payload: {},
  };
}

describe('proposeDecision', () => {
  it('tier 1 action auto-approves via policy', async () => {
    const d = await proposeDecision(proposal('screen.score_resume'));
    expect(d.tier).toBe('1');
    expect(d.state).toBe('approved');
    expect(d.approved_by).toBe('policy');
    expect(d.undo_expires_at).toBeNull();
  });

  it('tier 2 action approves with an undo window', async () => {
    const d = await proposeDecision(proposal('comms.candidate_outreach'));
    expect(d.state).toBe('approved');
    expect(d.undo_expires_at).not.toBeNull();
    expect(new Date(d.undo_expires_at!).getTime()).toBeGreaterThan(Date.now());
  });

  it('tier 3 action stays proposed', async () => {
    const d = await proposeDecision(proposal('client.submit_candidate'));
    expect(d.state).toBe('proposed');
    expect(d.approved_by).toBeNull();
  });

  it('money action class stays tier 3 even if autonomy_policy row says otherwise', async () => {
    await sql`update autonomy_policy set tier = '1' where org_id = ${orgId} and action_class = 'placement.assemble_offer'`;
    const d = await proposeDecision(proposal('placement.assemble_offer'));
    expect(d.tier).toBe('3');
    expect(d.state).toBe('proposed');
    expect(d.approved_by).toBeNull();
    await sql`update autonomy_policy set tier = '3' where org_id = ${orgId} and action_class = 'placement.assemble_offer'`;
  });

  it('rejects invalid input with ZodError', async () => {
    await expect(proposeDecision({ nope: true })).rejects.toThrow();
  });
});

describe('transitionDecision', () => {
  it('approves a tier 3 decision and stamps decided_at', async () => {
    const d = await proposeDecision(proposal('client.submit_candidate'));
    const approved = await transitionDecision(d.id, 'approved', 'user-1', orgId);
    expect(approved.state).toBe('approved');
    expect(approved.approved_by).toBe('user-1');
    expect(approved.decided_at).not.toBeNull();
  });

  it('rejects an illegal transition', async () => {
    const d = await proposeDecision(proposal('client.submit_candidate'));
    await expect(transitionDecision(d.id, 'executed', 'user-1', orgId))
      .rejects.toThrow('Invalid transition proposed → executed');
  });

  it('cancelling a proposed (never-approved) decision backfills decided_at and stamps cancelled_by', async () => {
    const d = await proposeDecision(proposal('client.submit_candidate'));
    const cancelled = await transitionDecision(d.id, 'cancelled', 'user-1', orgId);
    expect(cancelled.cancelled_by).toBe('user-1');
    expect(cancelled.cancelled_at).not.toBeNull();
    expect(cancelled.decided_at).not.toBeNull();
  });

  it('cancelling an already-approved decision (undo) preserves the original decided_at', async () => {
    const d = await proposeDecision(proposal('comms.candidate_outreach')); // tier 2, auto-approved
    const originalDecidedAt = d.decided_at;
    expect(originalDecidedAt).not.toBeNull();
    const cancelled = await transitionDecision(d.id, 'cancelled', 'user-2', orgId);
    expect(cancelled.decided_at).toEqual(originalDecidedAt);
    expect(cancelled.approved_by).toBe('policy');
    expect(cancelled.cancelled_by).toBe('user-2');
    expect(cancelled.cancelled_at).not.toBeNull();
  });

  it('rejects the losing side of a concurrent transition instead of silently overwriting it', async () => {
    const d = await proposeDecision(proposal('client.submit_candidate')); // tier 3 → proposed
    // Warm the shared db client's connection pool first: with a cold pool, the first call's
    // select+update round-trips complete before the second call's select even resolves, so
    // there's never any real contention to reject. Racing on already-open connections lets
    // both selects land before either update, which is what actually exercises the CAS guard.
    await Promise.all([getDecision(d.id), getDecision(d.id)]);
    const [a, b] = await Promise.allSettled([
      transitionDecision(d.id, 'approved', 'user-1', orgId),
      transitionDecision(d.id, 'cancelled', 'user-2', orgId),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toMatch(/already transitioned by another process/);
  });
});

describe('getDecision', () => {
  it('returns the row by id, or null if unknown', async () => {
    const d = await proposeDecision(proposal('screen.score_resume'));
    expect((await getDecision(d.id))?.id).toBe(d.id);
    expect(await getDecision('00000000-0000-7000-8000-000000000000')).toBeNull();
  });
});

describe('listQueue', () => {
  it('includes proposed and undo-window decisions, excludes tier-1 auto-approved', async () => {
    const t3 = await proposeDecision(proposal('client.submit_candidate'));
    const t2 = await proposeDecision(proposal('comms.candidate_outreach'));
    const t1 = await proposeDecision(proposal('screen.score_resume'));
    const queue = await listQueue(orgId);
    const ids = queue.map((q) => q.id);
    expect(ids).toContain(t3.id);
    expect(ids).toContain(t2.id);
    expect(ids).not.toContain(t1.id);
  });
});

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
    const executing = await transitionDecision(a.id, 'executing', 'screening', orgId);
    const failed = await transitionDecision(executing.id, 'failed', 'screening', orgId, { error: 'boom' });
    expect(failed.error).toBe('boom');

    const b = await proposeDecision(proposal('screen.score_resume'));
    await transitionDecision(b.id, 'executing', 'screening', orgId);
    const done = await transitionDecision(b.id, 'executed', 'screening', orgId, { outcome: { ok: true } });
    expect(done.outcome).toEqual({ ok: true });
    expect(done.executed_at).not.toBeNull();
  });

  it('still 409s on a lost compare-and-swap race (ADR-0003 must survive the extras change)', async () => {
    const d = await proposeDecision(proposal('comms.candidate_outreach')); // approved
    const [a, b] = await Promise.allSettled([
      transitionDecision(d.id, 'executing', 'communication', orgId),
      transitionDecision(d.id, 'cancelled', 'user-1', orgId),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const loser = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason.message).toMatch(/already transitioned by another process/);
  });
});
