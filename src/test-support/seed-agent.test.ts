import { describe, it, expect } from 'vitest';
import { requireAgentKey, type AgentIdentity } from '../lib/agent-auth';
import { seedTestAgent, seedTestAgentInFreshOrg } from './seed-agent';

function req(key: string): Request {
  return new Request('http://test/api/agent/x', { headers: { 'x-agent-api-key': key } });
}

describe('seedTestAgentInFreshOrg', () => {
  it('creates an agent scoped to a brand-new org, distinct from seedTestAgent\'s shared org', async () => {
    const shared = await seedTestAgent();
    const fresh = await seedTestAgentInFreshOrg();
    expect(fresh.orgId).not.toBe(shared.orgId);

    const result = await requireAgentKey(req(fresh.key));
    expect(result).not.toBeInstanceOf(Response);
    const identity = result as AgentIdentity;
    expect(identity.org_id).toBe(fresh.orgId);
    expect(identity.name).toBe(fresh.name);
  });

  it('produces a genuinely new org each call', async () => {
    const a = await seedTestAgentInFreshOrg();
    const b = await seedTestAgentInFreshOrg();
    expect(a.orgId).not.toBe(b.orgId);
  });
});
