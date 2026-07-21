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
