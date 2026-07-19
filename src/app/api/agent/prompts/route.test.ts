import { describe, it, expect } from 'vitest';
import { db } from '../../../../db/client';
import { system_prompts } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { GET } from './route';

function get(params: string, key: string) {
  return GET(new Request(`http://test/api/agent/prompts?${params}`, {
    headers: { 'x-agent-api-key': key },
  }));
}

describe('GET /api/agent/prompts', () => {
  it('401s without a key', async () => {
    const res = await GET(new Request('http://test/api/agent/prompts'));
    expect(res.status).toBe(401);
  });

  it('returns the active prompt scoped to the authenticated agent\'s org, ignoring a client-supplied org_id from another org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    await db.insert(system_prompts).values({
      org_id: owner.orgId, agent: 'screening', name: 'resume-scorer',
      version: 'v1', body: 'test prompt body', active: true,
    });

    const res = await get(`org_id=${other.orgId}&agent=screening&name=resume-scorer`, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.prompt.body).toBe('test prompt body');
  });

  it('404s when the active prompt belongs to a different org than the authenticated agent', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const requester = await seedTestAgentInFreshOrg();
    await db.insert(system_prompts).values({
      org_id: owner.orgId, agent: 'screening', name: 'resume-scorer',
      version: 'v1', body: 'other org prompt', active: true,
    });

    const res = await get(`org_id=${owner.orgId}&agent=screening&name=resume-scorer`, requester.key);
    expect(res.status).toBe(404);
  });
});
