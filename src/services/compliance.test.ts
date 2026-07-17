import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { checkCompliance } from './compliance';
import { logMessage } from './comms-log';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;

// 2026-07-09 is EDT (UTC-4): 18:00Z = 2pm local (inside window), 07:00Z = 3am local (quiet).
const DAYTIME = new Date('2026-07-09T18:00:00Z');
const NIGHT = new Date('2026-07-09T07:00:00Z');

async function makeCandidate(): Promise<string> {
  return (await sql`
    insert into candidates (org_id, full_name, email)
    values (${orgId}, 'Gate Test', ${'gate-' + Date.now() + Math.random() + '@example.com'}) returning id`)[0].id;
}

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

describe('checkCompliance', () => {
  it('allows a clean candidate during the day', async () => {
    const c = await makeCandidate();
    expect(await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, DAYTIME))
      .toEqual({ verdict: 'allow', reasons: [] });
  });

  it('denies on revoked consent regardless of time', async () => {
    const c = await makeCandidate();
    await sql`insert into consents (org_id, candidate_id, channel, status) values (${orgId}, ${c}, 'email', 'revoked')`;
    expect(await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, NIGHT))
      .toEqual({ verdict: 'deny', reasons: ['consent_revoked'] });
  });

  it('defers during quiet hours', async () => {
    const c = await makeCandidate();
    const r = await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, NIGHT);
    expect(r.verdict).toBe('defer');
    expect(r.reasons).toContain('quiet_hours');
  });

  it('defers on the frequency cap after 2 outbound touches this week', async () => {
    const c = await makeCandidate();
    for (const body of ['touch 1', 'touch 2']) {
      await logMessage({ org_id: orgId, candidate_id: c, channel: 'email', direction: 'outbound', body, decision_id: null });
    }
    const r = await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, DAYTIME);
    expect(r.verdict).toBe('defer');
    expect(r.reasons).toContain('frequency_cap');
  });

  it('granted consent does not defeat quiet hours', async () => {
    const c = await makeCandidate();
    await sql`insert into consents (org_id, candidate_id, channel, status) values (${orgId}, ${c}, 'email', 'granted')`;
    const r = await checkCompliance({ org_id: orgId, candidate_id: c, channel: 'email' }, NIGHT);
    expect(r.verdict).toBe('defer');
  });
});
