import { auth } from '../../lib/auth';
import { fetchRecentRuns, humanizeAgent, rosterFromRuns } from '../../services/agent-roster';
import type { RosterStatus } from '../../services/agent-roster';
import { throughputFromRuns } from '../../services/agent-throughput';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<RosterStatus, string> = {
  working: 'Working',
  review: 'Needs you',
  idle: 'Idle',
  stalled: 'Stalled',
};

export default async function AgentsPage() {
  const session = await auth();
  if (!session) return null;

  const runs = await fetchRecentRuns(session.user.org_id);
  const roster = rosterFromRuns(runs);
  const throughputByAgent = new Map(throughputFromRuns(runs).map((t) => [t.agent, t]));

  return (
    <main>
      <h1>Agents</h1>
      {roster.total === 0 && <p className="empty">No agent activity yet.</p>}
      <div className="agent-grid">
        {roster.entries.map((e) => {
          const t = throughputByAgent.get(e.agent);
          const completed = t?.completed ?? 0;
          const failed = t?.failed ?? 0;
          return (
            <div key={e.agent} className={`card agent-card${e.status === 'stalled' ? ' stalled' : ''}`}>
              <div className="agent-card-head">
                <span className="agent-card-name">{humanizeAgent(e.agent)}</span>
                <span className={`chip agent-status-chip status-${e.status}`}>
                  <span className={`dot roster-dot roster-${e.status}`} aria-hidden="true" />
                  {STATUS_LABEL[e.status]}
                </span>
              </div>
              <div className="agent-card-throughput">
                <span className="display tnum agent-card-count">{completed}</span>
                <span className="agent-card-sublabel">
                  completed{failed > 0 ? ` · ${failed} failed` : ''} (7d)
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
