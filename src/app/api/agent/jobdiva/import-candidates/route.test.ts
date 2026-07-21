import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { POST } from './route';

function post(body: unknown, key?: string) {
  return POST(new Request('http://test/api/agent/jobdiva/import-candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-agent-api-key': key } : {}) },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/jobdiva/import-candidates', () => {
  it('401s without a key', async () => {
    expect((await post({})).status).toBe(401);
  });

  it('400s on a malformed body', async () => {
    const { key } = await seedTestAgentInFreshOrg();
    expect((await post({ job_order_id: 'nope' }, key)).status).toBe(400);
  });

  it('502s as jobdiva_unavailable when JobDiva creds are missing/unreachable', async () => {
    const { key } = await seedTestAgentInFreshOrg();
    // No JOBDIVA_* env in test → defaultJobDivaClient() throws → route maps to 502.
    const res = await post({ job_order_id: randomUUID() }, key);
    expect([502, 404]).toContain(res.status); // 404 only if creds ARE set and job is missing
  });
});
