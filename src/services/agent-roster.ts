import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db/client';
import { agent_runs, agents } from '../db/schema';
import type { AgentRunRow } from './agent-runs';

export type RosterStatus = 'working' | 'review' | 'idle' | 'stalled';
export type RosterEntry = { agent: string; status: RosterStatus };
export type Roster = { entries: RosterEntry[]; online: number; total: number };

/** The run fields the roster derivation needs — AgentRunRow satisfies this. */
export type RosterRun = Pick<AgentRunRow, 'agent' | 'status' | 'started_at' | 'finished_at'>;

// An in-flight run older than this is treated as hung — a stalled Agent produces no queue
// items and is the roster's alarm state.
const STALL_MS = 10 * 60_000;

// How far back listRoster looks; an Agent with no run in this window drops off the roster.
const ROSTER_WINDOW_MS = 7 * 24 * 60 * 60_000;

function deriveStatus(run: RosterRun, now: Date): RosterStatus {
  const inFlight = run.finished_at === null;
  if (inFlight) {
    return now.getTime() - run.started_at.getTime() > STALL_MS ? 'stalled' : 'working';
  }
  // Finished: a failed run needs the operator's attention; a clean finish is idle.
  if (run.status === 'failed') return 'review';
  return 'idle';
}

/**
 * Pure selector: reduce Agent runs to one roster entry per Agent (its latest run's derived
 * status) plus an "N/M online" summary, where online is every Agent that isn't stalled.
 * Dumb tiles render this output directly.
 */
export function rosterFromRuns(runs: RosterRun[], now: Date = new Date()): Roster {
  const latest = new Map<string, RosterRun>();
  for (const r of runs) {
    const cur = latest.get(r.agent);
    if (!cur || r.started_at.getTime() > cur.started_at.getTime()) latest.set(r.agent, r);
  }
  const entries = [...latest.values()]
    .map((r) => ({ agent: r.agent, status: deriveStatus(r, now) }))
    .sort((a, b) => a.agent.localeCompare(b.agent));
  const online = entries.filter((e) => e.status !== 'stalled').length;
  return { entries, online, total: entries.length };
}

/**
 * Pure selector over the registered Agent roster: every registered Agent appears (its
 * status from its latest run, or 'idle' when it has none), plus any Agent that has runs
 * but isn't registered. This is the roster the operator supervises — a quiet Agent that
 * simply hasn't run stays on the team rather than vanishing.
 */
export function rosterFromAgents(
  registered: string[],
  runs: RosterRun[],
  now: Date = new Date(),
): Roster {
  const statusByAgent = new Map(rosterFromRuns(runs, now).entries.map((e) => [e.agent, e.status]));
  const names = new Set<string>([...registered, ...statusByAgent.keys()]);
  const entries = [...names]
    .map((agent) => ({ agent, status: statusByAgent.get(agent) ?? ('idle' as RosterStatus) }))
    .sort((a, b) => a.agent.localeCompare(b.agent));
  const online = entries.filter((e) => e.status !== 'stalled').length;
  return { entries, online, total: entries.length };
}

/**
 * The sidebar tile's view of the roster: the Agents needing attention (stalled or
 * needs-you, stalled first because it's the alarm), plus counts of the healthy rest.
 * A pure selector the dumb tile renders directly — no per-agent roll-call of the calm.
 */
export type RosterView = {
  attention: RosterEntry[];
  running: number;
  idle: number;
};

// Attention rows lead with the alarm: every stalled Agent before every needs-you one.
const ATTENTION_ORDER: Record<RosterStatus, number> = { stalled: 0, review: 1, working: 2, idle: 2 };

export function rosterView(roster: Roster): RosterView {
  const attention = roster.entries
    .filter((e) => e.status === 'stalled' || e.status === 'review')
    .sort((a, b) => ATTENTION_ORDER[a.status] - ATTENTION_ORDER[b.status]);
  const running = roster.entries.filter((e) => e.status === 'working').length;
  const idle = roster.entries.filter((e) => e.status === 'idle').length;
  return { attention, running, idle };
}

/** Fetch the org's recent Agent runs and derive the live roster. */
export async function fetchRecentRuns(orgId: string, now: Date = new Date()): Promise<RosterRun[]> {
  const since = new Date(now.getTime() - ROSTER_WINDOW_MS);
  return db
    .select({
      agent: agent_runs.agent,
      status: agent_runs.status,
      started_at: agent_runs.started_at,
      finished_at: agent_runs.finished_at,
    })
    .from(agent_runs)
    .where(and(eq(agent_runs.org_id, orgId), gte(agent_runs.started_at, since)));
}

/** The org's registered Agent names (the persona roster). */
export async function listRegisteredAgents(orgId: string): Promise<string[]> {
  const rows = await db.select({ name: agents.name }).from(agents).where(eq(agents.org_id, orgId));
  return rows.map((r) => r.name);
}

export async function listRoster(orgId: string, now: Date = new Date()): Promise<Roster> {
  const [registered, runs] = await Promise.all([
    listRegisteredAgents(orgId),
    fetchRecentRuns(orgId, now),
  ]);
  return rosterFromAgents(registered, runs, now);
}

export function humanizeAgent(agent: string): string {
  return agent
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
