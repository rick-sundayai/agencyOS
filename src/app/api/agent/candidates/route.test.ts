import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { candidates } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/candidates', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/candidates', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and ingests under the authenticated agent\'s org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();

    const res = await post({
      org_id: other.orgId, full_name: 'Ingested Candidate', email: `ingest-${Date.now()}@example.com`,
    }, owner.key);
    expect(res.status).toBe(201);
    const json = await res.json();
    const [candidate] = await db.select().from(candidates).where(eq(candidates.id, json.candidate_id));
    expect(candidate.org_id).toBe(owner.orgId);
  });
});
