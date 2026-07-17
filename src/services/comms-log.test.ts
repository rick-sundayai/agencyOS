import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { logMessage, countRecentOutbound, getConsentStatus, getActivePrompt } from './comms-log';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
let candidateId: string;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  candidateId = (await sql`
    insert into candidates (org_id, full_name, email)
    values (${orgId}, 'Comms Test', ${'comms-' + Date.now() + '@example.com'}) returning id`)[0].id;
});

describe('logMessage', () => {
  it('creates one conversation and reuses it for the second message', async () => {
    const a = await logMessage({ org_id: orgId, candidate_id: candidateId, channel: 'email', direction: 'outbound', body: 'first', decision_id: null });
    const b = await logMessage({ org_id: orgId, candidate_id: candidateId, channel: 'email', direction: 'outbound', body: 'second', decision_id: null });
    expect(a.conversation_id).toBe(b.conversation_id);
    expect(a.message_id).not.toBe(b.message_id);
  });
});

describe('countRecentOutbound', () => {
  it('counts the two outbound messages just logged', async () => {
    expect(await countRecentOutbound(orgId, candidateId, 'email')).toBe(2);
  });
});

describe('getConsentStatus', () => {
  it('is unknown with no row, revoked after revocation', async () => {
    expect(await getConsentStatus(orgId, candidateId, 'email')).toBe('unknown');
    await sql`insert into consents (org_id, candidate_id, channel, status) values (${orgId}, ${candidateId}, 'email', 'revoked')`;
    expect(await getConsentStatus(orgId, candidateId, 'email')).toBe('revoked');
  });
});

describe('getActivePrompt', () => {
  it('returns null when nothing is active under that name', async () => {
    expect(await getActivePrompt(orgId, 'screening', 'no-such-prompt')).toBeNull();
  });
});
