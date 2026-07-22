import Link from 'next/link';
import { auth } from '../../lib/auth';
import { listCandidates, listJobOrders } from '../../services/ats-views';
import { fitMeta } from '../../components/fit';
import { JobOrderFilter } from '../../components/JobOrderFilter';

export const dynamic = 'force-dynamic';

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const session = await auth();
  if (!session) return null;
  const { job } = await searchParams;
  const [rows, jobOrders] = await Promise.all([
    listCandidates(session.user.org_id, job ? { jobOrderId: job } : undefined),
    listJobOrders(session.user.org_id),
  ]);

  return (
    <main>
      <div className="page-head">
        <span className="eyebrow">Candidates</span>
        <h1>Candidates</h1>
        <p className="page-lede">
          Everyone the agents have sourced, screened, or advanced — across all job orders.
        </p>
        <JobOrderFilter
          jobOrders={jobOrders.map((j) => ({ id: j.id, title: j.title }))}
          selected={job ?? null}
        />
      </div>

      {rows.length === 0 ? (
        <p className="empty">No candidates yet.</p>
      ) : (
        <div className="rec-grid">
          {rows.map((c) => {
            const fit = fitMeta(c.score?.fit_rating);
            const ring = fitRing(c.score?.weighted_score ?? null);
            return (
              <Link key={c.id} href={`/candidates/${c.id}`} className="rec-card">
                <div className="rec-card-head">
                  <span className="rec-avatar" aria-hidden="true">{initials(c.full_name)}</span>
                  <div className="rec-card-title">
                    <div className="rec-card-name-row">
                      <span className="rec-card-name">{c.full_name}</span>
                      {fit && <span className={`fit-badge ${fit.tone}`}>{fit.label}</span>}
                    </div>
                    {c.current_title && <span className="rec-card-sub">{c.current_title}</span>}
                    {c.location && <span className="rec-card-meta">{c.location}</span>}
                  </div>
                  {ring && (
                    <span className={`fit-ring ${fit?.tone ?? ''}`} role="img"
                      aria-label={`Fit score ${ring.value}`}>
                      <svg viewBox="0 0 36 36" width="44" height="44">
                        <circle className="fit-ring-track" cx="18" cy="18" r="15.5" />
                        <circle className="fit-ring-value" cx="18" cy="18" r="15.5"
                          strokeDasharray={`${ring.dash} ${ring.gap}`} />
                      </svg>
                      <span className="fit-ring-num tnum">{ring.value}</span>
                    </span>
                  )}
                </div>
                <div className="rec-card-foot">
                  <span>Updated {relTime(c.created_at)}</span>
                  {c.source && <span className="chip">{c.source}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

/** Up to two initials for the card avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
  return (letters || '?').toUpperCase();
}

/** weighted_score is a 0–1 fraction (a Postgres numeric, arrives as string) → ring geometry as a percentage. */
function fitRing(weighted: string | null): { value: number; dash: number; gap: number } | null {
  if (weighted == null) return null;
  const n = Number(weighted);
  if (!Number.isFinite(n)) return null;
  const value = Math.round(Math.max(0, Math.min(1, n)) * 100);
  const circumference = 2 * Math.PI * 15.5; // r = 15.5 in the 36×36 viewBox
  const dash = (value / 100) * circumference;
  return { value, dash, gap: circumference - dash };
}

/** Compact "N days ago"-style relative time from a timestamp. */
function relTime(date: Date | string): string {
  const then = new Date(date).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
