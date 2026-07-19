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
