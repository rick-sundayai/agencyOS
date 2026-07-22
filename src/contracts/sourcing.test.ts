import { describe, it, expect } from 'vitest';
import {
  SOURCING_PHASES, TERMINAL_PHASES, isTerminalPhase, SourcingStatsSchema,
  ShortlistPayloadSchema,
} from './sourcing';

describe('sourcing contract constants', () => {
  it('has 8 phases in flow order', () => {
    expect(SOURCING_PHASES).toEqual([
      'queued', 'searching_pool', 'checking_jobdiva', 'embedding_new',
      'shortlisting', 'screening', 'done', 'failed',
    ]);
  });

  it('every terminal phase is a real phase', () => {
    for (const t of TERMINAL_PHASES) {
      expect(SOURCING_PHASES).toContain(t);
    }
  });

  it('terminal phases are exactly done and failed', () => {
    expect([...TERMINAL_PHASES].sort()).toEqual(['done', 'failed']);
  });
});

describe('isTerminalPhase', () => {
  it('is true for done and failed', () => {
    expect(isTerminalPhase('done')).toBe(true);
    expect(isTerminalPhase('failed')).toBe(true);
  });

  it('is false for every non-terminal phase', () => {
    for (const p of SOURCING_PHASES.filter((p) => p !== 'done' && p !== 'failed')) {
      expect(isTerminalPhase(p)).toBe(false);
    }
  });

  it('is false for an unknown string', () => {
    expect(isTerminalPhase('warp_speed')).toBe(false);
  });
});

describe('SourcingStatsSchema', () => {
  it('accepts well-typed known counters', () => {
    const parsed = SourcingStatsSchema.parse({
      pool_matches: 4, jobdiva_found: 12, embedded: 3, jobdiva_error: 'timeout',
    });
    expect(parsed).toMatchObject({ pool_matches: 4, jobdiva_found: 12, embedded: 3, jobdiva_error: 'timeout' });
  });

  it('rejects a known counter of the wrong type', () => {
    expect(SourcingStatsSchema.safeParse({ pool_matches: 'lots' }).success).toBe(false);
    expect(SourcingStatsSchema.safeParse({ jobdiva_error: 500 }).success).toBe(false);
  });

  it('passes an unknown key through instead of rejecting it', () => {
    const res = SourcingStatsSchema.safeParse({ pool_matches: 1, future_metric: 7 });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ pool_matches: 1, future_metric: 7 });
  });

  it('accepts an empty patch (all fields optional)', () => {
    expect(SourcingStatsSchema.safeParse({}).success).toBe(true);
  });
});

describe('ShortlistPayloadSchema', () => {
  const rankedEntry = {
    candidate_id: 'c1', full_name: 'Ada Lovelace', current_title: 'Engineer', distance: 0.21,
  };

  it('parses a well-formed payload into typed ranked entries', () => {
    const res = ShortlistPayloadSchema.safeParse({
      candidate_ids: ['c1'], ranked: [rankedEntry],
    });
    expect(res.success).toBe(true);
    expect(res.data?.ranked).toEqual([rankedEntry]);
  });

  it('defaults ranked to [] when absent', () => {
    const res = ShortlistPayloadSchema.safeParse({});
    expect(res.success).toBe(true);
    expect(res.data?.ranked).toEqual([]);
  });

  it('accepts a null current_title', () => {
    const res = ShortlistPayloadSchema.safeParse({ ranked: [{ ...rankedEntry, current_title: null }] });
    expect(res.success).toBe(true);
  });

  it('rejects a ranked entry with a wrong-typed field', () => {
    const bad = ShortlistPayloadSchema.safeParse({ ranked: [{ ...rankedEntry, distance: 'near' }] });
    expect(bad.success).toBe(false);
  });

  it('passes unknown top-level keys through', () => {
    const res = ShortlistPayloadSchema.safeParse({ ranked: [rankedEntry], foo: 'bar' });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ foo: 'bar' });
  });
});
