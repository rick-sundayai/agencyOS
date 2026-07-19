import { auth } from '../../lib/auth';
import {
  fetchRecentRuns,
  humanizeAgent,
  listRegisteredAgents,
  rosterFromAgents,
} from '../../services/agent-roster';
import type { RosterStatus } from '../../services/agent-roster';
import { throughputFromRuns } from '../../services/agent-throughput';
import { personaFor } from '../../services/agent-personas';

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

  const [registered, runs] = await Promise.all([
    listRegisteredAgents(session.user.org_id),
    fetchRecentRuns(session.user.org_id),
  ]);
  const roster = rosterFromAgents(registered, runs);
  const throughputByAgent = new Map(throughputFromRuns(runs).map((t) => [t.agent, t]));

  return (
    <main>
      <div className="page-head">
        <span className="eyebrow">Agents</span>
        <h1>Agents</h1>
        <p className="page-lede">
          Your team of autonomous agents — each with its own remit, live status, and 7-day throughput.
        </p>
      </div>

      {roster.total === 0 && <p className="empty">No agents registered yet.</p>}
      <div className="agent-grid">
        {roster.entries.map((e) => {
          const t = throughputByAgent.get(e.agent);
          const completed = t?.completed ?? 0;
          const failed = t?.failed ?? 0;
          const persona = personaFor(e.agent);
          return (
            <div key={e.agent} className={`card agent-card${e.status === 'stalled' ? ' stalled' : ''}`}>
              <div className="agent-card-head">
                <div className="agent-card-identity">
                  {persona && (
                    <span
                      className="agent-card-ico"
                      style={{ background: `${persona.color}1a`, color: persona.color }}
                      aria-hidden="true"
                    >
                      {persona.icon}
                    </span>
                  )}
                  <span className="agent-card-name">{humanizeAgent(e.agent)}</span>
                </div>
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
