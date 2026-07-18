import { auth } from '../../lib/auth';
import { listClients } from '../../services/ats-views';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const session = await auth();
  if (!session) return null;
  const rows = await listClients(session.user.org_id);
  return (
    <main>
      <h1>Clients</h1>
      <div className="record-list">
        <table className="list">
          <thead><tr><th>Name</th><th>Status</th><th>Open jobs</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><span className="chip">{c.status}</span></td>
                <td className="tnum">{c.open_jobs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty">No clients yet.</p>}
    </main>
  );
}
