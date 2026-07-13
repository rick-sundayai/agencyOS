import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../../../../lib/env';
import { POST, GET } from './route';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
const KEY = getEnv('AGENT_API_KEY');

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

function post(body: unknown, key = KEY) {
  return POST(new Request('http://test/api/agent/decisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

const validBody = () => ({
  org_id: orgId,
  agent: 'sourcing',
  action_class: 'source.shortlist',
  reasoning: { summary: 'top 10 by cosine', evidence: [], model: 'gemini-2.5-flash', prompt_version: 'v1' },
  payload: { candidate_ids: [] },
});

describe('POST /api/agent/decisions', () => {
  it('creates a decision and returns 201', async () => {
    const res = await post(validBody());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.decision.tier).toBe('1');
    expect(json.decision.state).toBe('approved');
  });

  it('returns 401 on a bad key', async () => {
    const res = await post(validBody(), 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('returns 400 with issues on invalid body', async () => {
    const res = await post({ agent: 'sourcing' });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(Array.isArray(json.issues)).toBe(true);
  });
});

describe('GET /api/agent/decisions', () => {
  it('returns the queue for an org', async () => {
    const res = await GET(new Request(`http://test/api/agent/decisions?org_id=${orgId}`, {
      headers: { 'x-agent-api-key': KEY },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.queue)).toBe(true);
  });
});
