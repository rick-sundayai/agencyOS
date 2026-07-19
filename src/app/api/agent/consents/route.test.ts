import { describe, it, expect } from 'vitest';
import { db } from '../../../../db/client';
import { candidates, consents } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { GET } from './route';

function get(params: string, key: string) {
  return GET(new Request(`http://test/api/agent/consents?${params}`, {
    headers: { 'x-agent-api-key': key },
  }));
}

describe('GET /api/agent/consents', () => {
  it('401s without a key', async () => {
    const res = await GET(new Request('http://test/api/agent/consents'));
    expect(res.status).toBe(401);
  });

  it('scopes to the authenticated agent\'s org, ignoring a client-supplied org_id from another org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Consent Candidate' })
      .returning();
    await db.insert(consents).values({
      org_id: owner.orgId, candidate_id: candidate.id, channel: 'email', status: 'granted',
    });

    const res = await get(`org_id=${other.orgId}&candidate_id=${candidate.id}&channel=email`, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('granted');
  });

  it('returns unknown (not another org\'s consent) when the consent belongs to a different org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const requester = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Isolated Candidate' })
      .returning();
    await db.insert(consents).values({
      org_id: owner.orgId, candidate_id: candidate.id, channel: 'sms', status: 'granted',
    });

    const res = await get(`org_id=${owner.orgId}&candidate_id=${candidate.id}&channel=sms`, requester.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('unknown');
  });
});
