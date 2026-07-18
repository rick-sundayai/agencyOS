import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getCandidateProfile } from '../../../services/ats-views';
import { listCandidateConsents } from '../../../services/comms-log';

export const dynamic = 'force-dynamic';

const CONSENT_TONE: Record<string, string> = {
  granted: 'consent-granted',
  revoked: 'consent-revoked',
  unknown: 'consent-unknown',
};

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return null;
  const { id } = await params;
  const profile = await getCandidateProfile(session.user.org_id, id);
  if (!profile) notFound();
  const { candidate, documents, applications, scores } = profile;
  const consents = await listCandidateConsents(session.user.org_id, id);

  return (
    <main>
      <h1>{candidate.full_name}</h1>
      <p>
        {candidate.current_title ?? 'No title'} · {candidate.location ?? 'No location'} ·{' '}
        {candidate.email ?? 'no email'} · {candidate.phone ?? 'no phone'}
      </p>

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

      <h2>Pipelines</h2>
      <div className="record-list">
        <table className="list">
          <thead><tr><th>Job</th><th>Stage</th><th>Updated</th></tr></thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/jobs/${a.job_order_id}`}>{a.job_title}</Link></td>
                <td><span className="chip">{a.stage}</span></td>
                <td>{new Date(a.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {applications.length === 0 && <p className="empty">Not in any pipeline.</p>}

      <h2>Scores</h2>
      <div className="record-list">
        <table className="list">
          <thead><tr><th>Fit</th><th>Score</th><th>Model</th><th>Prompt</th><th>When</th></tr></thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.id}>
                <td><span className="badge">{s.fit_rating}</span></td>
                <td className="tnum">{s.weighted_score ?? '—'}</td>
                <td>{s.model}</td>
                <td>{s.prompt_version}</td>
                <td>{new Date(s.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scores.length === 0 && <p className="empty">No scores yet.</p>}

      <h2>Documents</h2>
      <ul className="doc-list">
        {documents.map((d) => (
          <li key={d.id}>
            {d.kind} v{d.version} — <code>{d.storage_key}</code>
          </li>
        ))}
      </ul>
      {documents.length === 0 && <p className="empty">No documents.</p>}
    </main>
  );
}
