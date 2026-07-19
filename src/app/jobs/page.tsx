import Link from 'next/link';
import { auth } from '../../lib/auth';
import { listJobOrders } from '../../services/ats-views';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  contract: 'Contract',
  direct_hire: 'Direct hire',
};

export default async function JobsPage() {
  const session = await auth();
  if (!session) return null;
  const jobs = await listJobOrders(session.user.org_id);

  const open = jobs.filter((j) => j.status === 'open').length;
  const empty = jobs.filter((j) => j.candidate_count === 0).length;
  const inPipeline = jobs.reduce((sum, j) => sum + j.candidate_count, 0);

  return (
    <main>
      <div className="page-head">
        <span className="eyebrow">Job Orders</span>
        <h1>Open job orders</h1>
        <p className="page-lede">
          Every active mandate the agents are working — coverage and pipeline depth at a glance.
        </p>
      </div>

      <div className="rec-stats">
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Open reqs</span></div>
          <div className="htile-value"><span className="display tnum">{open}</span></div>
        </div>
        <div className={`htile${empty > 0 ? ' htile-warn' : ''}`}>
          <div className="htile-head">
            <span className="htile-dot" aria-hidden="true" />
            <span className="htile-label">Empty pipeline</span>
          </div>
          <div className="htile-value"><span className="display tnum">{empty}</span></div>
        </div>
        <div className="htile">
          <div className="htile-head"><span className="htile-label">In pipeline</span></div>
          <div className="htile-value"><span className="display tnum">{inPipeline}</span></div>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="empty">No job orders yet.</p>
      ) : (
        <div className="jo-list">
          {jobs.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="jo-card">
              <div className="jo-card-main">
                <div className="jo-card-title-row">
                  <span className="jo-card-title">
                    {j.client_name ? `${j.client_name} · ${j.title}` : j.title}
                  </span>
                  {j.candidate_count === 0 && <span className="flag-empty">No pipeline</span>}
                </div>
                <div className="jo-card-chips">
                  <span className="chip">{KIND_LABEL[j.kind] ?? j.kind}</span>
                  <span className={`status-chip status-${j.status}`}>{j.status}</span>
                </div>
              </div>
              <div className="jo-card-stats">
                <span className="jo-stat">
                  <span className="jo-stat-num tnum">{daysOpen(j.created_at)}</span>
                  <span className="jo-stat-label">days open</span>
                </span>
                <span className="jo-stat">
                  <span className="jo-stat-num tnum">{j.candidate_count}</span>
                  <span className="jo-stat-label">pipeline</span>
                </span>
                <span className="jo-card-chevron" aria-hidden="true">›</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

/** Whole days since a job order was created. */
function daysOpen(date: Date | string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
}
