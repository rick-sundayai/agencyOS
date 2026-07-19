import { auth } from '../../lib/auth';
import { listClients } from '../../services/ats-views';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const session = await auth();
  if (!session) return null;
  const rows = await listClients(session.user.org_id);

  return (
    <main>
      <div className="page-head">
        <span className="eyebrow">Clients</span>
        <h1>Clients</h1>
        <p className="page-lede">
          The accounts you place for — with how many job orders are open on each right now.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No clients yet.</p>
      ) : (
        <div className="rec-grid">
          {rows.map((c) => (
            <div key={c.id} className="rec-card rec-card-static">
              <div className="rec-card-head">
                <span className="rec-avatar" aria-hidden="true">{initials(c.name)}</span>
                <div className="rec-card-title">
                  <div className="rec-card-name-row">
                    <span className="rec-card-name">{c.name}</span>
                    <span className={`status-chip status-${c.status}`}>{c.status}</span>
                  </div>
                  <span className="rec-card-meta">Added {relTime(c.created_at)}</span>
                </div>
                <span className="jo-stat">
                  <span className="jo-stat-num tnum">{c.open_jobs}</span>
                  <span className="jo-stat-label">open jobs</span>
                </span>
              </div>
            </div>
          ))}
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
