import { auth } from '../../lib/auth';
import { getPipelineBoard } from '../../services/ats-views';
import type { PipelineStage } from '../../services/ats-views';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<PipelineStage, string> = {
  sourced: 'Sourced',
  screened: 'Screened',
  submitted: 'Submitted',
  interviewing: 'Interviewing',
  offer: 'Offer',
  placed: 'Placed',
  rejected: 'Rejected',
};

const TERMINAL_STAGES = new Set<PipelineStage>(['placed', 'rejected']);

export default async function PipelinePage() {
  const session = await auth();
  if (!session) return null;

  const board = await getPipelineBoard(session.user.org_id);

  return (
    <main>
      <h1>Pipeline</h1>
      <div className="pipeline-board">
        {board.map((col) => (
          <div
            key={col.stage}
            className={`pipeline-col stage-${col.stage}${TERMINAL_STAGES.has(col.stage) ? ' terminal' : ''}`}
          >
            <div className="pipeline-col-head">
              <span className={`dot pipeline-dot stage-${col.stage}`} aria-hidden="true" />
              <span className="pipeline-col-label">{STAGE_LABEL[col.stage]}</span>
              <span className="chip tnum pipeline-col-count">{col.cards.length}</span>
            </div>
            <div className="pipeline-col-body">
              {col.cards.length === 0 && <p className="pipeline-empty">Empty</p>}
              {col.cards.map((card) => (
                <div key={card.application_id} className="card pipeline-card">
                  <div className="pipeline-card-candidate">{card.candidate_name}</div>
                  <div className="pipeline-card-job">{card.job_title}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
