import Link from 'next/link';
import { humanizeAgent, rosterView } from '../services/agent-roster';
import type { Roster } from '../services/agent-roster';
import { personaFor } from '../services/agent-personas';

// The only two statuses that reach the attention list; their label + tone.
const ATTENTION_LABEL: Record<'stalled' | 'review', string> = {
  stalled: 'Stalled',
  review: 'Needs you',
};

/**
 * The sidebar's Agent tile — a dumb tile over the roster selector's view. It leads with
 * the Agents that need the operator (stalled first, then needs-you) linking through to the
 * Agents page, and collapses every healthy Agent into an "N running · M idle" summary
 * rather than a roll-call. Empty renders nothing rather than an empty shell.
 */
export function AgentRoster({ roster }: { roster: Roster }) {
  if (roster.total === 0) return null;
  const { attention, running, idle } = rosterView(roster);
  return (
    <div className="roster">
      <div className="roster-head">
        Agents <span className="roster-online">· {running} running · {idle} idle</span>
      </div>
      {attention.length > 0 && (
        <Link href="/agents" className="roster-attention" aria-label="Agents needing attention">
          <ul className="roster-list">
            {attention.map((e) => {
              const persona = personaFor(e.agent);
              const status = e.status as 'stalled' | 'review';
              return (
                <li key={e.agent} className={`roster-row${status === 'stalled' ? ' stalled' : ' review'}`}>
                  {persona && (
                    <span
                      className="roster-ico"
                      style={{ background: `${persona.color}1a`, color: persona.color }}
                      aria-hidden="true"
                    >
                      {persona.icon}
                    </span>
                  )}
                  <span className="roster-name">{humanizeAgent(e.agent)}</span>
                  <span className="roster-status">{ATTENTION_LABEL[status]}</span>
                </li>
              );
            })}
          </ul>
        </Link>
      )}
    </div>
  );
}
