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
