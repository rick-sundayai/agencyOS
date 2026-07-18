import Link from 'next/link';
import { auth } from '../../lib/auth';
import { listJobOrders } from '../../services/ats-views';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const session = await auth();
  if (!session) return null;
  const jobs = await listJobOrders(session.user.org_id);
  return (
    <main>
      <h1>Job orders</h1>
      <div className="record-list">
        <table className="list">
          <thead>
            <tr><th>Title</th><th>Client</th><th>Kind</th><th>Status</th><th>Candidates</th></tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><Link href={`/jobs/${j.id}`}>{j.title}</Link></td>
                <td>{j.client_name ?? '—'}</td>
                <td><span className="chip">{j.kind}</span></td>
                <td><span className="chip">{j.status}</span></td>
                <td className="tnum">{j.candidate_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {jobs.length === 0 && <p className="empty">No job orders yet.</p>}
    </main>
  );
}
