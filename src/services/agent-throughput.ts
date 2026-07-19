import type { RosterRun } from './agent-roster';

export type AgentThroughput = { agent: string; completed: number; failed: number };

export function throughputFromRuns(runs: RosterRun[]): AgentThroughput[] {
  const byAgent = new Map<string, AgentThroughput>();
  for (const r of runs) {
    if (r.finished_at === null) continue;
    const entry = byAgent.get(r.agent) ?? { agent: r.agent, completed: 0, failed: 0 };
    if (r.status === 'failed') entry.failed += 1;
    else entry.completed += 1;
    byAgent.set(r.agent, entry);
  }
  return [...byAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}
