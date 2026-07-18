import { describe, it, expect } from 'vitest';
import { rosterFromRuns, type RosterRun } from './agent-roster';

const NOW = new Date('2026-07-18T12:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function run(partial: Partial<RosterRun> & { agent: string }): RosterRun {
  return { status: 'succeeded', started_at: minsAgo(1), finished_at: minsAgo(1), ...partial };
}

describe('rosterFromRuns', () => {
  it('maps a fresh in-flight run to working', () => {
    const { entries } = rosterFromRuns([run({ agent: 'screening', status: 'running', started_at: minsAgo(2), finished_at: null })], NOW);
    expect(entries).toEqual([{ agent: 'screening', status: 'working' }]);
  });

  it('maps an in-flight run past the stall threshold to stalled', () => {
    const { entries } = rosterFromRuns([run({ agent: 'sourcing', status: 'running', started_at: minsAgo(45), finished_at: null })], NOW);
    expect(entries).toEqual([{ agent: 'sourcing', status: 'stalled' }]);
  });

  it('maps a finished failed run to review (needs you)', () => {
    const { entries } = rosterFromRuns([run({ agent: 'placement', status: 'failed' })], NOW);
    expect(entries[0].status).toBe('review');
  });

  it('maps a finished succeeded run to idle', () => {
    const { entries } = rosterFromRuns([run({ agent: 'aftercare', status: 'succeeded' })], NOW);
    expect(entries[0].status).toBe('idle');
  });

  it('keeps only the latest run per agent', () => {
    const { entries, total } = rosterFromRuns(
      [
        run({ agent: 'screening', status: 'failed', started_at: minsAgo(30), finished_at: minsAgo(29) }),
        run({ agent: 'screening', status: 'running', started_at: minsAgo(2), finished_at: null }),
      ],
      NOW,
    );
    expect(total).toBe(1);
    expect(entries[0].status).toBe('working'); // newest run wins
  });

  it('counts N/M online, excluding stalled Agents', () => {
    const roster = rosterFromRuns(
      [
        run({ agent: 'screening', status: 'running', started_at: minsAgo(1), finished_at: null }), // working
        run({ agent: 'placement', status: 'failed' }), // review
        run({ agent: 'aftercare', status: 'succeeded' }), // idle
        run({ agent: 'sourcing', status: 'running', started_at: minsAgo(60), finished_at: null }), // stalled
      ],
      NOW,
    );
    expect(roster.total).toBe(4);
    expect(roster.online).toBe(3); // all but the stalled one
  });

  it('sorts entries by agent for a stable roster', () => {
    const { entries } = rosterFromRuns(
      [run({ agent: 'sourcing' }), run({ agent: 'aftercare' }), run({ agent: 'placement' })],
      NOW,
    );
    expect(entries.map((e) => e.agent)).toEqual(['aftercare', 'placement', 'sourcing']);
  });

  it('is empty when there are no runs', () => {
    expect(rosterFromRuns([], NOW)).toEqual({ entries: [], online: 0, total: 0 });
  });
});
