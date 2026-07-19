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
    expect(a.decisionsPerDay).toBe(0); // round1(1/30) rounds down to 0.0 at 1 decimal — the windowing exclusion is what this test verifies
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

describe('computeAnalytics — stage distribution', () => {
  it('returns every pipeline stage at zero when there are no applications', () => {
    const a = computeAnalytics(emptyInput(), NOW);
    expect(a.stageDistribution).toEqual([
      { stage: 'sourced', count: 0 },
      { stage: 'screened', count: 0 },
      { stage: 'submitted', count: 0 },
      { stage: 'interviewing', count: 0 },
      { stage: 'offer', count: 0 },
      { stage: 'placed', count: 0 },
      { stage: 'rejected', count: 0 },
    ]);
  });

  it('counts applications by current stage', () => {
    const input = {
      ...emptyInput(),
      applications: [{ stage: 'sourced' }, { stage: 'sourced' }, { stage: 'placed' }],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.stageDistribution.find((s) => s.stage === 'sourced')?.count).toBe(2);
    expect(a.stageDistribution.find((s) => s.stage === 'placed')?.count).toBe(1);
    expect(a.stageDistribution.find((s) => s.stage === 'rejected')?.count).toBe(0);
  });
});

describe('computeAnalytics — placements per month', () => {
  it('zero-fills 6 trailing months (oldest to newest) with no placements', () => {
    const a = computeAnalytics(emptyInput(), NOW);
    expect(a.placementsPerMonth).toEqual([
      { month: '2026-02', count: 0 },
      { month: '2026-03', count: 0 },
      { month: '2026-04', count: 0 },
      { month: '2026-05', count: 0 },
      { month: '2026-06', count: 0 },
      { month: '2026-07', count: 0 },
    ]);
  });

  it('buckets placements by start_date month and ignores placements outside the window', () => {
    const input = {
      ...emptyInput(),
      placements: [
        { start_date: '2026-07-05', application_created_at: daysAgo(40) },
        { start_date: '2026-07-10', application_created_at: daysAgo(50) },
        { start_date: '2026-06-01', application_created_at: daysAgo(70) },
        { start_date: '2025-01-01', application_created_at: daysAgo(400) }, // outside 6mo window
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.placementsPerMonth.find((p) => p.month === '2026-07')?.count).toBe(2);
    expect(a.placementsPerMonth.find((p) => p.month === '2026-06')?.count).toBe(1);
    expect(a.placementsPerMonth.reduce((s, p) => s + p.count, 0)).toBe(3);
  });

  it('ignores placements with no start_date', () => {
    const input = { ...emptyInput(), placements: [{ start_date: null, application_created_at: daysAgo(1) }] };
    const a = computeAnalytics(input, NOW);
    expect(a.placementsPerMonth.reduce((s, p) => s + p.count, 0)).toBe(0);
  });
});

describe('computeAnalytics — time to fill', () => {
  it('is null with no filled placements', () => {
    const a = computeAnalytics(emptyInput(), NOW);
    expect(a.timeToFillDays).toBeNull();
  });

  it('averages days between application creation and placement start', () => {
    const input = {
      ...emptyInput(),
      placements: [
        { start_date: '2026-01-11', application_created_at: new Date('2026-01-01T00:00:00Z') }, // 10 days
        { start_date: '2026-01-21', application_created_at: new Date('2026-01-01T00:00:00Z') }, // 20 days
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.timeToFillDays).toBe(15);
  });

  it('excludes placements with no start_date from the average', () => {
    const input = {
      ...emptyInput(),
      placements: [
        { start_date: '2026-01-11', application_created_at: new Date('2026-01-01T00:00:00Z') }, // 10 days
        { start_date: null, application_created_at: new Date('2026-01-01T00:00:00Z') },
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.timeToFillDays).toBe(10);
  });
});

describe('computeAnalytics — candidate sources', () => {
  it('is empty with no candidates', () => {
    const a = computeAnalytics(emptyInput(), NOW);
    expect(a.candidateSources).toEqual([]);
  });

  it('groups candidates by source, sorted by count descending', () => {
    const input = {
      ...emptyInput(),
      candidates: [
        { source: 'referral' }, { source: 'referral' }, { source: 'linkedin' },
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.candidateSources).toEqual([
      { source: 'referral', count: 2 },
      { source: 'linkedin', count: 1 },
    ]);
  });

  it('buckets null or blank source as Unknown', () => {
    const input = { ...emptyInput(), candidates: [{ source: null }, { source: '' }, { source: 'linkedin' }] };
    const a = computeAnalytics(input, NOW);
    expect(a.candidateSources).toEqual([
      { source: 'Unknown', count: 2 },
      { source: 'linkedin', count: 1 },
    ]);
  });
});

describe('computeAnalytics — agent performance', () => {
  it('delegates to throughputFromRuns', () => {
    const input = {
      ...emptyInput(),
      agentRuns: [
        { agent: 'screening', status: 'succeeded', started_at: daysAgo(1), finished_at: daysAgo(1) },
      ],
    };
    const a = computeAnalytics(input, NOW);
    expect(a.agentPerformance).toEqual([{ agent: 'screening', completed: 1, failed: 0 }]);
  });
});
