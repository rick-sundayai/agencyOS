import { describe, it, expect, beforeAll } from 'vitest';
import { seedTestAgent, seedTestAgentInFreshOrg } from '../../../../../../test-support/seed-agent';
import { proposeDecision, getDecision } from '../../../../../../services/decision-store';
import { POST } from './route';

let orgId: string;
let KEY: string;
let AGENT_NAME: string;

beforeAll(async () => {
  ({ orgId, key: KEY, name: AGENT_NAME } = await seedTestAgent());
});

function post(id: string, body: unknown, key = KEY) {
  return POST(
    new Request(`http://test/api/agent/decisions/${id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const tier3Proposal = (org = orgId) => ({
  org_id: org,
  agent: 'placement',
  action_class: 'client.submit_candidate',
  reasoning: { summary: 'ready to submit', evidence: [], model: 'claude', prompt_version: 'v1' },
  payload: {},
});

describe('POST /api/agent/decisions/[id]/transition', () => {
  it('transitions a proposed decision to approved', async () => {
    const d = await proposeDecision(tier3Proposal());
    const res = await post(d.id, { to: 'approved' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.decision.state).toBe('approved');
    expect(json.decision.approved_by).toBe(AGENT_NAME);
  });

  it('returns 401 on a bad key', async () => {
    const d = await proposeDecision(tier3Proposal());
    const res = await post(d.id, { to: 'approved' }, 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a decision that does not exist', async () => {
    const res = await post('00000000-0000-0000-0000-000000000000', { to: 'approved' });
    expect(res.status).toBe(404);
  });

  it('returns 404 (not the decision) when the authenticated agent belongs to a different org', async () => {
    const other = await seedTestAgentInFreshOrg();
    const d = await proposeDecision(tier3Proposal());
    const res = await post(d.id, { to: 'approved' }, other.key);
    expect(res.status).toBe(404);
    const unchanged = await getDecision(d.id);
    expect(unchanged?.state).toBe('proposed');
  });

  it('returns 409 for an illegal transition (InvalidTransitionError)', async () => {
    const d = await proposeDecision(tier3Proposal()); // starts 'proposed'
    const res = await post(d.id, { to: 'executed' }); // proposed can only go to approved/cancelled
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid transition/);
  });
});
