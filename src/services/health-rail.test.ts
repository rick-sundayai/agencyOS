import { describe, it, expect } from 'vitest';
import { computeHealthSignals, type HealthInput } from './health-rail';
import type { Roster } from './agent-roster';

const emptyRoster: Roster = { entries: [], online: 0, total: 0 };

function queueOf(specs: Array<{ tier?: string; state?: string; undo?: boolean }>): HealthInput['queue'] {
  return specs.map((s) => ({
    tier: s.tier ?? '3',
    state: s.state ?? 'proposed',
    undo_expires_at: s.undo ? new Date('2030-01-01') : null,
  }));
}

const byId = (sigs: ReturnType<typeof computeHealthSignals>) =>
  Object.fromEntries(sigs.map((s) => [s.id, s]));

describe('computeHealthSignals', () => {
  it('is all-healthy (every signal good) with an empty queue and no stalled Agents', () => {
    const sigs = computeHealthSignals({ queue: [], roster: emptyRoster });
    expect(sigs.every((s) => s.status === 'good')).toBe(true);
    // Condensed strip derives from this: no non-good signals => "all healthy".
    expect(sigs.filter((s) => s.status !== 'good')).toHaveLength(0);
  });

  it('flags any Risk-tier Decision as an alert', () => {
    const sigs = byId(computeHealthSignals({ queue: queueOf([{ tier: 'risk' }]), roster: emptyRoster }));
    expect(sigs.risk.status).toBe('alert');
    expect(sigs.risk.value).toBe(1);
  });

  it('keeps Risk good when nothing is flagged', () => {
    const sigs = byId(computeHealthSignals({ queue: queueOf([{ tier: '3' }]), roster: emptyRoster }));
    expect(sigs.risk.status).toBe('good');
    expect(sigs.risk.value).toBe(0);
  });

  it('escalates the Queue signal across its thresholds', () => {
    const good = byId(computeHealthSignals({ queue: queueOf(Array(10).fill({})), roster: emptyRoster }));
    const warn = byId(computeHealthSignals({ queue: queueOf(Array(40).fill({})), roster: emptyRoster }));
    const alert = byId(computeHealthSignals({ queue: queueOf(Array(100).fill({})), roster: emptyRoster }));
    expect(good.queue.status).toBe('good');
    expect(warn.queue.status).toBe('warn');
    expect(alert.queue.status).toBe('alert');
  });

  it('pins the exact Queue thresholds (warn > 25, alert > 75)', () => {
    const statusAt = (n: number) =>
      byId(computeHealthSignals({ queue: queueOf(Array(n).fill({})), roster: emptyRoster })).queue.status;
    expect(statusAt(25)).toBe('good'); // boundary: 25 is still good
    expect(statusAt(26)).toBe('warn');
    expect(statusAt(75)).toBe('warn'); // boundary: 75 is still warn
    expect(statusAt(76)).toBe('alert');
  });

  it('alerts when an Agent is stalled', () => {
    const roster: Roster = { entries: [{ agent: 'sourcing', status: 'stalled' }], online: 0, total: 1 };
    const sigs = byId(computeHealthSignals({ queue: [], roster }));
    expect(sigs.agents.status).toBe('alert');
    expect(sigs.agents.value).toBe(1);
  });

  it('warns when Decisions are in their Undo window', () => {
    const sigs = byId(computeHealthSignals({ queue: queueOf([{ state: 'approved', undo: true }]), roster: emptyRoster }));
    expect(sigs.undo.status).toBe('warn');
    expect(sigs.undo.value).toBe(1);
  });

  it('gives every signal a value, unit, detail, status, and a drill target', () => {
    for (const s of computeHealthSignals({ queue: [], roster: emptyRoster })) {
      expect(typeof s.value).toBe('number');
      expect(s.unit).toBeTruthy();
      expect(s.detail).toBeTruthy();
      expect(['good', 'warn', 'alert']).toContain(s.status);
      expect(s.drill).toMatch(/^\//);
    }
  });
});
