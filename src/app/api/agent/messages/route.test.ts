import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { candidates, conversations } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/messages', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/messages', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and logs under the authenticated agent\'s org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const [candidate] = await db.insert(candidates)
      .values({ org_id: owner.orgId, full_name: 'Message Candidate' })
      .returning();

    const res = await post({
      org_id: other.orgId, candidate_id: candidate.id, channel: 'email',
      direction: 'outbound', body: 'hello',
    }, owner.key);
    expect(res.status).toBe(201);
    const json = await res.json();
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, json.conversation_id));
    expect(conv.org_id).toBe(owner.orgId);
  });
});
