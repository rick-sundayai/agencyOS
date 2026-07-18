import type { DecisionRow } from './decision-store';
import type { Roster } from './agent-roster';

export type HealthStatus = 'good' | 'warn' | 'alert';

/** One operational vital sign: a number, its framing, a status, and where tapping drills to. */
export type HealthSignal = {
  id: string;
  label: string;
  value: number;
  unit: string;
  detail: string;
  status: HealthStatus;
  drill: string;
};

export type HealthInput = {
  queue: Array<Pick<DecisionRow, 'tier' | 'state' | 'undo_expires_at'>>;
  roster: Roster;
};

// Queue-backlog thresholds — a modest queue is healthy; a large one is worth flagging.
const QUEUE_WARN = 25;
const QUEUE_ALERT = 75;

/**
 * Pure selector: derive the Health rail's vital signs from data already loaded for the
 * Cockpit — the Decision queue and the Agent roster. Each signal carries its value, unit,
 * short detail, status (good/warn/alert), and drill target; dumb tiles render this directly.
 * "Color is the alarm": a signal is only ever warn/alert when something genuinely needs the
 * operator, so a healthy rail is entirely good.
 */
export function computeHealthSignals({ queue, roster }: HealthInput): HealthSignal[] {
  // The Undo-window rows are a subset of the queue (approved, auto-executing soon), so the
  // Queue tile reads "in queue" — not "awaiting you" — to avoid claiming them as human work;
  // the Undo tile surfaces that subset on its own.
  const pending = queue.length;
  const risk = queue.filter((d) => d.tier === 'risk').length;
  const undoing = queue.filter((d) => d.state === 'approved' && d.undo_expires_at !== null).length;
  const stalled = roster.entries.filter((e) => e.status === 'stalled').length;

  return [
    {
      id: 'queue',
      label: 'Queue',
      value: pending,
      unit: 'pending',
      detail: pending === 0 ? 'Clear' : `${pending} in queue`,
      status: pending > QUEUE_ALERT ? 'alert' : pending > QUEUE_WARN ? 'warn' : 'good',
      drill: '/',
    },
    {
      id: 'risk',
      label: 'Risk',
      value: risk,
      unit: 'flagged',
      detail: risk === 0 ? 'None flagged' : `${risk} need resolution`,
      status: risk > 0 ? 'alert' : 'good',
      drill: '/',
    },
    {
      id: 'agents',
      label: 'Agents',
      value: stalled,
      unit: 'stalled',
      detail: stalled === 0 ? 'All producing' : `${stalled} not producing`,
      status: stalled > 0 ? 'alert' : 'good',
      drill: '/agents',
    },
    {
      id: 'undo',
      label: 'Undo window',
      value: undoing,
      unit: 'auto-exec',
      detail: undoing === 0 ? 'None pending' : `${undoing} auto-executing`,
      status: undoing > 0 ? 'warn' : 'good',
      drill: '/',
    },
  ];
}
