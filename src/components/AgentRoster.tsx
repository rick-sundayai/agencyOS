import { humanizeAgent } from '../services/agent-roster';
import type { Roster, RosterStatus } from '../services/agent-roster';

// Dot tone per status — a stalled Agent reads --bad (the alarm); the rest stay calm.
const STATUS_DOT: Record<RosterStatus, string> = {
  working: 'roster-working',
  review: 'roster-review',
  idle: 'roster-idle',
  stalled: 'roster-stalled',
};

/**
 * The sidebar's live Agent roster — a dumb tile rendering the roster selector's output:
 * every Agent with its status and an "N/M online" summary, with stalled Agents standing
 * out in --bad. Empty (no recent runs) renders nothing rather than an empty shell.
 */
export function AgentRoster({ roster }: { roster: Roster }) {
  if (roster.total === 0) return null;
  return (
    <div className="roster">
      <div className="roster-head">
        Agents <span className="roster-online">· {roster.online}/{roster.total} online</span>
      </div>
      <ul className="roster-list">
        {roster.entries.map((e) => (
          <li key={e.agent} className={`roster-row${e.status === 'stalled' ? ' stalled' : ''}`}>
            <span className="roster-name">{humanizeAgent(e.agent)}</span>
            <span className={`dot roster-dot ${STATUS_DOT[e.status]}`} title={e.status} aria-label={e.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
