import { describe, it, expect } from 'vitest';
import { computeAnalytics } from './analytics';

const NOW = new Date('2026-07-19T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60_000);

function emptyInput() {
  return { decisions: [], applications: [], placements: [], candidates: [], agentRuns: [] };
}

describe('computeAnalytics — decisions metrics', () => {
  it('returns zeros with no decisions', () => {
    const a = computeAnalytics(emptyInput(), NOW);
    expect(a.decisionsPerDay).toBe(0);
    expect(a.autoRunRate).toBe(0);
    expect(a.tierSplit).toEqual([]);
  });

  it('counts decisions/day over the trailing 30 days', () => {
    const input = {
      ...emptyInput(),
      decisions: [
        { tier: '1', approved_by: 'policy', proposed_at: daysAgo(1) },
        { tier: '1', approved_by: 'policy', proposed_at: daysAgo(2) },
        { tier: '2', approved_by: null, proposed_at: daysAgo(3) },
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.decisionsPerDay).toBeCloseTo(0.1, 5); // 3 / 30
  });

  it('excludes decisions older than the 30-day window', () => {
    const input = {
      ...emptyInput(),
      decisions: [
        { tier: '1', approved_by: 'policy', proposed_at: daysAgo(1) },
        { tier: '1', approved_by: 'policy', proposed_at: daysAgo(31) },
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.decisionsPerDay).toBeCloseTo(1 / 30, 5);
  });

  it('computes auto-run rate as policy-approved / total in window', () => {
    const input = {
      ...emptyInput(),
      decisions: [
        { tier: '1', approved_by: 'policy', proposed_at: daysAgo(1) },
        { tier: '2', approved_by: 'policy', proposed_at: daysAgo(1) },
        { tier: '3', approved_by: 'user-abc', proposed_at: daysAgo(1) },
        { tier: '3', approved_by: null, proposed_at: daysAgo(1) },
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.autoRunRate).toBe(0.5); // 2 of 4
  });

  it('splits decisions by tier, only tiers present, in fixed order 1,2,3,risk', () => {
    const input = {
      ...emptyInput(),
      decisions: [
        { tier: 'risk', approved_by: null, proposed_at: daysAgo(1) },
        { tier: '1', approved_by: 'policy', proposed_at: daysAgo(1) },
        { tier: '1', approved_by: 'policy', proposed_at: daysAgo(1) },
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.tierSplit).toEqual([
      { tier: '1', count: 2 },
      { tier: 'risk', count: 1 },
    ]);
  });
});
