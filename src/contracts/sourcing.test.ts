import { describe, it, expect } from 'vitest';
import { SOURCING_PHASES, TERMINAL_PHASES, isTerminalPhase } from './sourcing';

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
