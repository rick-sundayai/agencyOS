import { describe, it, expect } from 'vitest';
import { throughputFromRuns } from './agent-throughput';
import type { RosterRun } from './agent-roster';

const NOW = new Date('2026-07-18T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function run(partial: Partial<RosterRun> & { agent: string }): RosterRun {
  return { status: 'succeeded', started_at: minsAgo(1), finished_at: minsAgo(1), ...partial };
}

describe('throughputFromRuns', () => {
  it('is empty when there are no runs', () => {
    expect(throughputFromRuns([])).toEqual([]);
  });

  it('counts a succeeded run as completed', () => {
    expect(throughputFromRuns([run({ agent: 'screening', status: 'succeeded' })])).toEqual([
      { agent: 'screening', completed: 1, failed: 0 },
    ]);
  });

  it('counts a failed run as failed, not completed', () => {
    expect(throughputFromRuns([run({ agent: 'placement', status: 'failed' })])).toEqual([
      { agent: 'placement', completed: 0, failed: 1 },
    ]);
  });

  it('excludes in-flight runs from throughput entirely', () => {
    expect(
      throughputFromRuns([run({ agent: 'sourcing', status: 'running', finished_at: null })]),
    ).toEqual([]);
  });

  it('sums multiple runs for the same agent', () => {
    expect(
      throughputFromRuns([
        run({ agent: 'screening', status: 'succeeded', started_at: minsAgo(10), finished_at: minsAgo(9) }),
        run({ agent: 'screening', status: 'failed', started_at: minsAgo(5), finished_at: minsAgo(4) }),
        run({ agent: 'screening', status: 'succeeded', started_at: minsAgo(1), finished_at: minsAgo(1) }),
      ]),
    ).toEqual([{ agent: 'screening', completed: 2, failed: 1 }]);
  });

  it('summarizes multiple agents, sorted by agent', () => {
    expect(
      throughputFromRuns([run({ agent: 'sourcing' }), run({ agent: 'aftercare' }), run({ agent: 'placement' })]),
    ).toEqual([
      { agent: 'aftercare', completed: 1, failed: 0 },
      { agent: 'placement', completed: 1, failed: 0 },
      { agent: 'sourcing', completed: 1, failed: 0 },
    ]);
  });
});
