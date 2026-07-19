import { auth } from '../../lib/auth';
import { computeAnalytics, fetchAnalyticsInput } from '../../services/analytics';
import { humanizeAgent } from '../../services/agent-roster';
import type { PipelineStage } from '../../services/ats-views';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<PipelineStage, string> = {
  sourced: 'Sourced',
  screened: 'Screened',
  submitted: 'Submitted',
  interviewing: 'Interviewing',
  offer: 'Offer',
  placed: 'Placed',
  rejected: 'Rejected',
};

const TIER_LABEL: Record<string, string> = {
  '1': 'Tier 1 · Auto',
  '2': 'Tier 2 · Undo window',
  '3': 'Tier 3 · Needs approval',
  risk: 'Risk',
};

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session) return null;

  const input = await fetchAnalyticsInput(session.user.org_id);
  const a = computeAnalytics(input);

  const tierTotal = Math.max(1, a.tierSplit.reduce((sum, t) => sum + t.count, 0));
  const maxStage = Math.max(1, ...a.stageDistribution.map((s) => s.count));
  const maxSource = Math.max(1, ...a.candidateSources.map((s) => s.count));
  const maxPlacements = Math.max(1, ...a.placementsPerMonth.map((p) => p.count));

  return (
    <main>
      <h1>Analytics</h1>

      <div className="hrail analytics-kpis">
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Decisions / day</span></div>
          <div className="htile-value"><span className="display tnum">{a.decisionsPerDay}</span></div>
          <div className="htile-detail">trailing 30 days</div>
        </div>
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Auto-run rate</span></div>
          <div className="htile-value">
            <span className="display tnum">{Math.round(a.autoRunRate * 100)}</span>
            <span className="htile-unit">%</span>
          </div>
          <div className="htile-detail">approved by policy</div>
        </div>
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Time to fill</span></div>
          <div className="htile-value">
            <span className="display tnum">{a.timeToFillDays ?? '—'}</span>
            {a.timeToFillDays !== null && <span className="htile-unit">days</span>}
          </div>
          <div className="htile-detail">avg, all placements</div>
        </div>
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Placements</span></div>
          <div className="htile-value"><span className="display tnum">{a.placementsPerMonth.at(-1)?.count ?? 0}</span></div>
          <div className="htile-detail">this month</div>
        </div>
      </div>

      <div className="analytics-grid">
        <section className="card analytics-panel">
          <h2>Autonomy Tier split</h2>
          {a.tierSplit.length === 0 && <p className="empty">No decisions yet.</p>}
          <ul className="analytics-barlist">
            {a.tierSplit.map((t) => (
              <li key={t.tier}>
                <span className="analytics-barlabel">{TIER_LABEL[t.tier] ?? t.tier}</span>
                <span className="analytics-bar">
                  <span className="analytics-bar-fill" style={{ width: `${Math.round((t.count / tierTotal) * 100)}%` }} />
                </span>
                <span className="analytics-barcount tnum">{t.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card analytics-panel">
          <h2>Stage distribution</h2>
          <ul className="analytics-barlist">
            {a.stageDistribution.map((s) => (
              <li key={s.stage}>
                <span className="analytics-barlabel">{STAGE_LABEL[s.stage]}</span>
                <span className="analytics-bar">
                  <span className="analytics-bar-fill" style={{ width: `${Math.round((s.count / maxStage) * 100)}%` }} />
                </span>
                <span className="analytics-barcount tnum">{s.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card analytics-panel">
          <h2>Placements per month</h2>
          <ul className="analytics-barlist">
            {a.placementsPerMonth.map((p) => (
              <li key={p.month}>
                <span className="analytics-barlabel">{p.month}</span>
                <span className="analytics-bar">
                  <span className="analytics-bar-fill" style={{ width: `${Math.round((p.count / maxPlacements) * 100)}%` }} />
                </span>
                <span className="analytics-barcount tnum">{p.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card analytics-panel">
          <h2>Candidate sources</h2>
          {a.candidateSources.length === 0 && <p className="empty">No candidates yet.</p>}
          <ul className="analytics-barlist">
            {a.candidateSources.map((s) => (
              <li key={s.source}>
                <span className="analytics-barlabel">{s.source}</span>
                <span className="analytics-bar">
                  <span className="analytics-bar-fill" style={{ width: `${Math.round((s.count / maxSource) * 100)}%` }} />
                </span>
                <span className="analytics-barcount tnum">{s.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card analytics-panel analytics-panel-wide">
          <h2>Agent team performance</h2>
          {a.agentPerformance.length === 0 && <p className="empty">No agent activity yet.</p>}
          <ul className="analytics-barlist">
            {a.agentPerformance.map((t) => {
              const total = Math.max(1, t.completed + t.failed);
              return (
                <li key={t.agent}>
                  <span className="analytics-barlabel">{humanizeAgent(t.agent)}</span>
                  <span className="analytics-bar">
                    <span className="analytics-bar-fill" style={{ width: `${Math.round((t.completed / total) * 100)}%` }} />
                  </span>
                  <span className="analytics-barcount tnum">
                    {t.completed} done{t.failed > 0 ? ` · ${t.failed} failed` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
