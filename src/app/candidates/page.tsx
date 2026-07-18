import Link from 'next/link';
import { auth } from '../../lib/auth';
import { listCandidates } from '../../services/ats-views';

export const dynamic = 'force-dynamic';

export default async function CandidatesPage() {
  const session = await auth();
  if (!session) return null;
  const rows = await listCandidates(session.user.org_id);
  return (
    <main>
      <h1>Candidates</h1>
      <div className="record-list">
        <table className="list">
          <thead>
            <tr><th>Name</th><th>Title</th><th>Email</th><th>Location</th><th>Source</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/candidates/${c.id}`}>{c.full_name}</Link></td>
                <td>{c.current_title ?? '—'}</td>
                <td>{c.email ?? '—'}</td>
                <td>{c.location ?? '—'}</td>
                <td>{c.source ? <span className="chip">{c.source}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty">No candidates yet.</p>}
    </main>
  );
}
