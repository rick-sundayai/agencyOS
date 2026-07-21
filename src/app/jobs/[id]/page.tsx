import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getJobOrderPipeline, PIPELINE_STAGES } from '../../../services/ats-views';
import type { PipelineStage } from '../../../services/ats-views';
import SourcingPanel from './SourcingPanel';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<PipelineStage, string> = {
  sourced: 'Sourced', screened: 'Screened', submitted: 'Submitted',
  interviewing: 'Interviewing', offer: 'Offer', placed: 'Placed', rejected: 'Rejected',
};

const TERMINAL_STAGES = new Set<PipelineStage>(['placed', 'rejected']);

const KIND_LABEL: Record<string, string> = {
  contract: 'Contract',
  direct_hire: 'Direct hire',
};

const FIT: Record<string, { label: string; tone: string }> = {
  yes: { label: 'Strong fit', tone: 'fit-good' },
  borderline: { label: 'Borderline', tone: 'fit-warn' },
  no: { label: 'Poor fit', tone: 'fit-bad' },
};

export default async function JobPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const session = await auth();
  if (!session) return null;
  const { id } = await params;
  const sp = await searchParams;
  const job = await getJobOrderPipeline(session.user.org_id, id);
  if (!job) notFound();

  const mustHaves = (job.must_haves as string[] | null) ?? [];
  const niceToHaves = (job.nice_to_haves as string[] | null) ?? [];
  const columns = PIPELINE_STAGES.map((stage) => ({
    stage,
    apps: job.applications.filter((a) => a.stage === stage),
  }));
  const inPipeline = job.applications.length;
  const active = job.applications.filter((a) => !TERMINAL_STAGES.has(a.stage as PipelineStage)).length;
  const placed = job.applications.filter((a) => a.stage === 'placed').length;

  return (
    <main>
      <Link className="back-link" href="/jobs">‹ Job orders</Link>

      <div className="detail-head">
        <div className="detail-head-main">
          {job.client_name && <span className="eyebrow">{job.client_name}</span>}
          <h1>{job.title}</h1>
          <div className="detail-contacts">
            <span className="chip">{KIND_LABEL[job.kind] ?? job.kind}</span>
            <span className={`status-chip status-${job.status}`}>{job.status}</span>
          </div>
          {job.description && <p className="detail-sub">{job.description}</p>}
        </div>
      </div>

      <div className="rec-stats">
        <div className="htile">
          <div className="htile-head"><span className="htile-label">In pipeline</span></div>
          <div className="htile-value"><span className="display tnum">{inPipeline}</span></div>
        </div>
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Active</span></div>
          <div className="htile-value"><span className="display tnum">{active}</span></div>
        </div>
        <div className="htile">
          <div className="htile-head"><span className="htile-label">Placed</span></div>
          <div className="htile-value"><span className="display tnum">{placed}</span></div>
        </div>
      </div>

      <SourcingPanel jobId={id} autoStart={sp.source === '1'} />

      <section className="detail-panel">
        <h2>Requirements</h2>
        <div className="req-block">
          <span className="req-label">Must-haves</span>
          <div className="tags">
            {mustHaves.length > 0 ? mustHaves.map((m) => <span key={m}>{m}</span>) : <span>—</span>}
          </div>
        </div>
        <div className="req-block">
          <span className="req-label">Nice-to-haves</span>
          <div className="tags">
            {niceToHaves.length > 0 ? niceToHaves.map((m) => <span key={m}>{m}</span>) : <span>—</span>}
          </div>
        </div>
      </section>

      <section className="detail-panel">
        <h2>Pipeline</h2>
        <div className="pipeline-board">
          {columns.map(({ stage, apps }) => (
            <div
              key={stage}
              className={`pipeline-col stage-${stage}${TERMINAL_STAGES.has(stage) ? ' terminal' : ''}`}
            >
              <div className="pipeline-col-head">
                <span className={`dot pipeline-dot stage-${stage}`} aria-hidden="true" />
                <span className="pipeline-col-label">{STAGE_LABEL[stage]}</span>
                <span className="chip tnum pipeline-col-count">{apps.length}</span>
              </div>
              <div className="pipeline-col-body">
                {apps.length === 0 && <p className="pipeline-empty">Empty</p>}
                {apps.map((a) => {
                  const f = a.score?.fit_rating ? FIT[a.score.fit_rating] : null;
                  return (
                    <Link key={a.application_id} href={`/candidates/${a.candidate_id}`} className="card pipeline-card">
                      <div className="pipeline-card-candidate">{a.candidate_name}</div>
                      {a.current_title && <div className="pipeline-card-job">{a.current_title}</div>}
                      {f && <span className={`fit-badge ${f.tone}`}>{f.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
