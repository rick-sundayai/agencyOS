import { describe, it, expect } from 'vitest';
import {
  rosterFromAgents,
  rosterFromRuns,
  rosterView,
  type Roster,
  type RosterEntry,
  type RosterRun,
} from './agent-roster';

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

describe('rosterFromAgents', () => {
  it('lists every registered agent as idle when none have runs', () => {
    const roster = rosterFromAgents(['Scout', 'Sift', 'Echo'], [], NOW);
    expect(roster).toEqual({
      entries: [
        { agent: 'Echo', status: 'idle' },
        { agent: 'Scout', status: 'idle' },
        { agent: 'Sift', status: 'idle' },
      ],
      online: 3,
      total: 3,
    });
  });

  it('overlays live run status onto the registered agent', () => {
    const roster = rosterFromAgents(
      ['Scout', 'Sift'],
      [run({ agent: 'Scout', status: 'running', started_at: minsAgo(2), finished_at: null })],
      NOW,
    );
    expect(roster.entries).toEqual([
      { agent: 'Scout', status: 'working' },
      { agent: 'Sift', status: 'idle' },
    ]);
  });

  it('includes an agent that has runs but is not registered', () => {
    const roster = rosterFromAgents(
      ['Scout'],
      [run({ agent: 'legacy-worker', status: 'succeeded' })],
      NOW,
    );
    expect(roster.entries.map((e) => e.agent).sort()).toEqual(['Scout', 'legacy-worker']);
    expect(roster.total).toBe(2);
  });

  it('excludes stalled agents from the online count', () => {
    const roster = rosterFromAgents(
      ['Scout', 'Sentry'],
      [run({ agent: 'Sentry', status: 'running', started_at: minsAgo(45), finished_at: null })],
      NOW,
    );
    expect(roster.online).toBe(1);
    expect(roster.total).toBe(2);
  });
});

describe('rosterView', () => {
  const roster = (entries: RosterEntry[]): Roster => ({
    entries,
    total: entries.length,
    online: entries.filter((e) => e.status !== 'stalled').length,
  });

  it('leaves attention empty and counts running/idle when all healthy', () => {
    const view = rosterView(
      roster([
        { agent: 'Atlas', status: 'working' },
        { agent: 'Scout', status: 'working' },
        { agent: 'Sift', status: 'idle' },
      ]),
    );
    expect(view.attention).toEqual([]);
    expect(view.running).toBe(2);
    expect(view.idle).toBe(1);
  });

  it('surfaces a stalled agent in attention', () => {
    const view = rosterView(
      roster([
        { agent: 'Scout', status: 'idle' },
        { agent: 'Sentry', status: 'stalled' },
      ]),
    );
    expect(view.attention).toEqual([{ agent: 'Sentry', status: 'stalled' }]);
    expect(view.running).toBe(0);
    expect(view.idle).toBe(1);
  });

  it('orders stalled before review and keeps idle out of attention', () => {
    const view = rosterView(
      roster([
        { agent: 'Atlas', status: 'review' },
        { agent: 'Echo', status: 'idle' },
        { agent: 'Scout', status: 'working' },
        { agent: 'Sentry', status: 'stalled' },
      ]),
    );
    expect(view.attention).toEqual([
      { agent: 'Sentry', status: 'stalled' },
      { agent: 'Atlas', status: 'review' },
    ]);
    expect(view.running).toBe(1);
    expect(view.idle).toBe(1);
  });

  it('returns empty attention and zero counts for an empty roster', () => {
    const view = rosterView(roster([]));
    expect(view.attention).toEqual([]);
    expect(view.running).toBe(0);
    expect(view.idle).toBe(0);
  });
});
