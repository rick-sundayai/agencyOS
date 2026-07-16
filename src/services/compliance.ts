import { z } from 'zod';
import { CHANNELS, countRecentOutbound, getConsentStatus } from './comms-log';

// Per-org configuration is a later phase; one org today (spec: own agency first).
export const QUIET_HOURS = { tz: 'America/New_York', startHour: 8, endHour: 20 } as const;
export const FREQUENCY_CAP = { maxOutbound: 2, windowDays: 7 } as const;

export type ComplianceVerdict = 'allow' | 'defer' | 'deny';

export const ComplianceInputSchema = z.strictObject({
  org_id: z.uuid(),
  candidate_id: z.uuid(),
  channel: z.enum(CHANNELS),
});

export function localHour(now: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now));
}

export async function checkCompliance(
  input: unknown,
  now: Date = new Date(),
): Promise<{ verdict: ComplianceVerdict; reasons: string[] }> {
  const p = ComplianceInputSchema.parse(input);

  if ((await getConsentStatus(p.org_id, p.candidate_id, p.channel)) === 'revoked') {
    return { verdict: 'deny', reasons: ['consent_revoked'] };
  }

  const reasons: string[] = [];
  const hour = localHour(now, QUIET_HOURS.tz);
  if (hour < QUIET_HOURS.startHour || hour >= QUIET_HOURS.endHour) reasons.push('quiet_hours');
  if ((await countRecentOutbound(p.org_id, p.candidate_id, p.channel, FREQUENCY_CAP.windowDays)) >= FREQUENCY_CAP.maxOutbound) {
    reasons.push('frequency_cap');
  }
  return { verdict: reasons.length > 0 ? 'defer' : 'allow', reasons };
}
