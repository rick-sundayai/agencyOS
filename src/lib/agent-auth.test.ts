import { describe, it, expect, beforeAll } from 'vitest';
import { seedTestAgent } from '../test-support/seed-agent';
import { hashApiKey, requireAgentKey, type AgentIdentity } from './agent-auth';

let orgId: string;
let KEY: string;
let AGENT_NAME: string;

beforeAll(async () => {
  ({ orgId, key: KEY, name: AGENT_NAME } = await seedTestAgent());
});

function req(key?: string): Request {
  return new Request('http://test/api/agent/x', { headers: key ? { 'x-agent-api-key': key } : {} });
}

describe('hashApiKey', () => {
  it('is a deterministic 64-char hex sha256 digest', () => {
    const h = hashApiKey('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('abc')).toBe(h);
    expect(hashApiKey('abcd')).not.toBe(h);
  });
});

describe('requireAgentKey', () => {
  it('401s when no key header is present', async () => {
    const result = await requireAgentKey(req());
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('401s on an unknown key', async () => {
    const result = await requireAgentKey(req('not-a-real-key'));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it('resolves the agent identity for a valid key', async () => {
    const result = await requireAgentKey(req(KEY));
    expect(result).not.toBeInstanceOf(Response);
    const identity = result as AgentIdentity;
    expect(identity.name).toBe(AGENT_NAME);
    expect(identity.org_id).toBe(orgId);
    expect(identity.id).toBeTruthy();
  });
});
