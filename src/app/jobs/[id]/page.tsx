import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getJobOrderPipeline, PIPELINE_STAGES } from '../../../services/ats-views';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return null;
  const { id } = await params;
  const job = await getJobOrderPipeline(session.user.org_id, id);
  if (!job) notFound();

  const mustHaves = (job.must_haves as string[] | null) ?? [];
  const niceToHaves = (job.nice_to_haves as string[] | null) ?? [];
  const columns = PIPELINE_STAGES.map((stage) => ({
    stage,
    apps: job.applications.filter((a) => a.stage === stage),
  }));

  return (
    <main>
      <h1>{job.title}</h1>
      <p>{job.client_name ?? 'No client'} · {job.kind} · {job.status}</p>
      {job.description && <p>{job.description}</p>}

      <h2>Must-haves</h2>
      <div className="tags">
        {mustHaves.length > 0 ? mustHaves.map((m) => <span key={m}>{m}</span>) : <span>—</span>}
      </div>
      <h2>Nice-to-haves</h2>
      <div className="tags">
        {niceToHaves.length > 0 ? niceToHaves.map((m) => <span key={m}>{m}</span>) : <span>—</span>}
      </div>

      <h2>Pipeline</h2>
      <div className="board">
        {columns.map(({ stage, apps }) => (
          <div className="col" key={stage}>
            <h3>{stage} ({apps.length})</h3>
            {apps.map((a) => (
              <div className="card" key={a.application_id}>
                <Link href={`/candidates/${a.candidate_id}`}>{a.candidate_name}</Link>
                {a.current_title && <p>{a.current_title}</p>}
                {a.score && (
                  <p><span className="badge">{a.score.fit_rating}</span> {a.score.weighted_score ?? ''}</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
