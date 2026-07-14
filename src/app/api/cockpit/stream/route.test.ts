import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../../../../lib/auth', () => ({ auth: vi.fn() }));

import postgres from 'postgres';
import { auth } from '../../../../lib/auth';
import { getEnv } from '../../../../lib/env';
import { proposeDecision } from '../../../../services/decision-store';
import { GET } from './route';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

describe('GET /api/cockpit/stream', () => {
  it('returns 401 without a session', async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('streams the org queue as an SSE event', async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'u1', org_id: orgId },
      expires: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const d = await proposeDecision({
      org_id: orgId,
      agent: 'placement',
      action_class: 'client.submit_candidate',
      reasoning: { summary: 'sse test', evidence: [], model: 'claude', prompt_version: 'v1' },
      payload: {},
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text.startsWith('data: ')).toBe(true);
    const payload = JSON.parse(text.slice('data: '.length));
    expect(payload.queue.map((q: { id: string }) => q.id)).toContain(d.id);
    await reader.cancel();
  });
});
