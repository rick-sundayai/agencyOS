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
