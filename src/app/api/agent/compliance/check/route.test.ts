import { describe, it, expect } from 'vitest';
import { db } from '../../../../../db/client';
import { candidates, consents } from '../../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/compliance/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/compliance/check', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/compliance/check', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id: a revoked consent in another org does not leak into the authenticated agent\'s own org verdict', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: other.orgId, full_name: 'Revoked Elsewhere' })
      .returning();
    await db.insert(consents).values({
      org_id: other.orgId, candidate_id: candidate.id, channel: 'email', status: 'revoked',
    });

    const res = await post({ org_id: other.orgId, candidate_id: candidate.id, channel: 'email' }, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reasons).not.toContain('consent_revoked');
  });
});
