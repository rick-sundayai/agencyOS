import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getCandidateProfile } from '../../../services/ats-views';
import { listCandidateConsents } from '../../../services/comms-log';
import { fitMeta } from '../../../components/fit';

export const dynamic = 'force-dynamic';

const CONSENT_TONE: Record<string, string> = {
  granted: 'consent-granted',
  revoked: 'consent-revoked',
  unknown: 'consent-unknown',
};

const STAGE_LABEL: Record<string, string> = {
  sourced: 'Sourced', screened: 'Screened', submitted: 'Submitted',
  interviewing: 'Interviewing', offer: 'Offer', placed: 'Placed', rejected: 'Rejected',
};

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return null;
  const { id } = await params;
  const profile = await getCandidateProfile(session.user.org_id, id);
  if (!profile) notFound();
  const { candidate, documents, applications, scores } = profile;
  const consents = await listCandidateConsents(session.user.org_id, id);

  const latest = scores[0] ?? null; // scores are ordered newest-first
  const fit = fitMeta(latest?.fit_rating);
  const ring = fitRing(latest?.weighted_score ?? null);

  return (
    <main>
      <Link className="back-link" href="/candidates">‹ Candidates</Link>

      <div className="detail-head">
        <span className="rec-avatar detail-avatar" aria-hidden="true">{initials(candidate.full_name)}</span>
        <div className="detail-head-main">
          <div className="rec-card-name-row">
            <h1>{candidate.full_name}</h1>
            {fit && <span className={`fit-badge ${fit.tone}`}>{fit.label}</span>}
          </div>
          <p className="detail-sub">
            {candidate.current_title ?? 'No title'} · {candidate.location ?? 'No location'}
          </p>
          <div className="detail-contacts">
            {candidate.email && <span className="chip">{candidate.email}</span>}
            {candidate.phone && <span className="chip">{candidate.phone}</span>}
            {candidate.source && <span className="chip">{candidate.source}</span>}
          </div>
        </div>
        {ring && (
          <span className={`fit-ring detail-ring ${fit?.tone ?? ''}`} role="img"
            aria-label={`Fit score ${ring.value}`}>
            <svg viewBox="0 0 36 36" width="56" height="56">
              <circle className="fit-ring-track" cx="18" cy="18" r="15.5" />
              <circle className="fit-ring-value" cx="18" cy="18" r="15.5"
                strokeDasharray={`${ring.dash} ${ring.gap}`} />
            </svg>
            <span className="fit-ring-num tnum">{ring.value}</span>
          </span>
        )}
      </div>

      <div className="rec-stats">
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Pipelines</span></div>
          <div className="htile-value"><span className="display tnum">{applications.length}</span></div>
        </div>
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Scores</span></div>
          <div className="htile-value"><span className="display tnum">{scores.length}</span></div>
        </div>
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Documents</span></div>
          <div className="htile-value"><span className="display tnum">{documents.length}</span></div>
        </div>
      </div>

      <section className="detail-panel">
        <h2>Consent</h2>
        {consents.length === 0 ? (
          <p className="empty">No consent on record.</p>
        ) : (
          <div className="consent-list">
            {consents.map((c) => (
              <span key={c.channel} className={`consent-item ${CONSENT_TONE[c.status] ?? 'consent-unknown'}`}>
                <span className="dot" aria-hidden="true" />
                {c.channel}: {c.status}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="detail-panel">
        <h2>Pipelines</h2>
        {applications.length === 0 ? (
          <p className="empty">Not in any pipeline.</p>
        ) : (
          <ul className="detail-rows">
            {applications.map((a) => (
              <li className="detail-row" key={a.id}>
                <div className="detail-row-main">
                  <Link className="detail-row-title" href={`/jobs/${a.job_order_id}`}>{a.job_title}</Link>
                </div>
                <span className="stage-tag">
                  <span className={`dot pipeline-dot stage-${a.stage}`} aria-hidden="true" />
                  {STAGE_LABEL[a.stage] ?? a.stage}
                </span>
                <span className="detail-row-meta">{new Date(a.updated_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-panel">
        <h2>Scores</h2>
        {scores.length === 0 ? (
          <p className="empty">No scores yet.</p>
        ) : (
          <ul className="detail-rows">
            {scores.map((s) => {
              const f = fitMeta(s.fit_rating);
              return (
                <li className="detail-row" key={s.id}>
                  <div className="detail-row-main">
                    <span className="detail-row-title">
                      {f
                        ? <span className={`fit-badge ${f.tone}`}>{f.label}</span>
                        : <span className="badge">{s.fit_rating}</span>}
                      {s.weighted_score != null && <span className="detail-score tnum">{s.weighted_score}</span>}
                    </span>
                    <span className="detail-row-sub">{s.model} · {s.prompt_version}</span>
                  </div>
                  <span className="detail-row-meta">{new Date(s.created_at).toLocaleDateString()}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="detail-panel">
        <h2>Documents</h2>
        {documents.length === 0 ? (
          <p className="empty">No documents.</p>
        ) : (
          <ul className="doc-list">
            {documents.map((d) => (
              <li key={d.id}>{d.kind} v{d.version} — <code>{d.storage_key}</code></li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** Up to two initials for the header avatar. */
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
