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
