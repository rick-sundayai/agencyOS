import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/auth', () => ({ auth: vi.fn() }));

import postgres from 'postgres';
import { auth } from '../lib/auth';
import { getEnv } from '../lib/env';
import { proposeDecision, getDecision } from '../services/decision-store';
import { approveDecisionAction, cancelDecisionAction } from './queue-actions';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
let adminUserId: string;
let recruiterUserId: string;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  // Real rows, not fake ids — requireCanAct now re-checks role against the database
  // (not the mocked session), so these need to actually exist to be looked up.
  const tag = Date.now();
  adminUserId = (await sql`
    insert into users (org_id, email, full_name, role) values
    (${orgId}, ${'qa-admin-' + tag + '@example.com'}, 'QA Admin', 'admin') returning id`)[0].id;
  recruiterUserId = (await sql`
    insert into users (org_id, email, full_name, role) values
    (${orgId}, ${'qa-recruiter-' + tag + '@example.com'}, 'QA Recruiter', 'recruiter') returning id`)[0].id;
});

const tier3Proposal = () => ({
  org_id: orgId,
  agent: 'placement',
  action_class: 'client.submit_candidate',
  reasoning: { summary: 'ready to submit', evidence: [], model: 'claude', prompt_version: 'v1' },
  payload: {},
});

function loggedIn(role: 'admin' | 'recruiter' = 'admin') {
  const id = role === 'admin' ? adminUserId : recruiterUserId;
  vi.mocked(auth).mockResolvedValue({
    user: { id, org_id: orgId, role },
    expires: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe('approveDecisionAction', () => {
  it('approves a proposed tier-3 decision as the session user', async () => {
    loggedIn();
    const d = await proposeDecision(tier3Proposal());
    const row = await approveDecisionAction(d.id);
    expect(row.state).toBe('approved');
    expect(row.approved_by).toBe(adminUserId);
    expect(row.decided_at).not.toBeNull();
  });

  it('throws without a session', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const d = await proposeDecision(tier3Proposal());
    await expect(approveDecisionAction(d.id)).rejects.toThrow('Unauthorized');
  });
});

describe('cancelDecisionAction', () => {
  it('cancels a proposed decision (reject)', async () => {
    loggedIn();
    const d = await proposeDecision(tier3Proposal());
    const row = await cancelDecisionAction(d.id);
    expect(row.state).toBe('cancelled');
  });

  it('cancels an approved undo-window decision (undo)', async () => {
    loggedIn();
    const d = await proposeDecision({
      ...tier3Proposal(),
      agent: 'engagement',
      action_class: 'comms.candidate_outreach', // tier 2 → auto-approved with undo window
    });
    expect(d.state).toBe('approved');
    const row = await cancelDecisionAction(d.id);
    expect(row.state).toBe('cancelled');
  });

  it('surfaces a friendly error when a concurrent action already resolved the decision', async () => {
    loggedIn();
    const d = await proposeDecision(tier3Proposal());
    // Warm-up: without this, the underlying pg pool has at most one idle connection at this
    // point (every earlier test in this file issues DB calls sequentially, never concurrently),
    // so whichever call below is dispatched first claims that lone warm connection and races
    // through its whole read-then-write sequence before the second call's connection even
    // finishes its handshake — the two actions end up serialized instead of racing, and the
    // test can spuriously never observe a rejection. Firing two reads concurrently here forces
    // a second connection to already exist and be idle by the time the real race fires below,
    // so both actions start on equal footing.
    await Promise.all([getDecision(d.id), getDecision(d.id)]);
    const [a, b] = await Promise.allSettled([
      approveDecisionAction(d.id),
      cancelDecisionAction(d.id),
    ]);
    const rejected = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    expect(rejected).toBeDefined();
    expect(rejected!.reason.message).toBe('This decision was already handled — refresh the queue.');
  });
});

describe('role-based authorization', () => {
  it('a recruiter cannot approve a tier-3 decision', async () => {
    loggedIn('recruiter');
    const d = await proposeDecision(tier3Proposal());
    await expect(approveDecisionAction(d.id)).rejects.toThrow('Forbidden');
  });

  it('a recruiter can undo a tier-2 decision', async () => {
    loggedIn('recruiter');
    const d = await proposeDecision({
      ...tier3Proposal(),
      agent: 'engagement',
      action_class: 'comms.candidate_outreach', // tier 2 → auto-approved
    });
    const row = await cancelDecisionAction(d.id);
    expect(row.state).toBe('cancelled');
  });

  it('a stale session role is not trusted — a DB demotion blocks the very next action', async () => {
    loggedIn('admin'); // mocked session still claims 'admin'
    await sql`update users set role = 'recruiter' where id = ${adminUserId}`; // demoted in the DB
    try {
      const d = await proposeDecision(tier3Proposal());
      await expect(approveDecisionAction(d.id)).rejects.toThrow('Forbidden');
    } finally {
      await sql`update users set role = 'admin' where id = ${adminUserId}`; // restore for other tests
    }
  });
});
