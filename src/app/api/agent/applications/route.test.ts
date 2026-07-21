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

  it('404s when job_order_id belongs to a different org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const requester = await seedTestAgentInFreshOrg();
    const [job] = await db.insert(job_orders).values({
      org_id: owner.orgId, title: `Job ${randomUUID()}`, kind: 'contract',
    }).returning();
    const [cand] = await db.insert(candidates).values({ org_id: owner.orgId, full_name: 'Ada' }).returning();

    const res = await post({ job_order_id: job.id, candidate_ids: [cand.id] }, requester.key);
    expect(res.status).toBe(404);
  });

  it('400s when a candidate_id belongs to a different org', async () => {
    const { orgId, key } = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [job] = await db.insert(job_orders).values({
      org_id: orgId, title: `Job ${randomUUID()}`, kind: 'contract',
    }).returning();
    const [foreignCand] = await db.insert(candidates)
      .values({ org_id: other.orgId, full_name: 'Foreign' }).returning();

    const res = await post({ job_order_id: job.id, candidate_ids: [foreignCand.id] }, key);
    expect(res.status).toBe(400);
  });
});
