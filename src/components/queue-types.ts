import type { DecisionRow } from '../services/decision-store';

/** DecisionRow with dates as ISO strings — what crosses the server→client boundary
 *  (RSC props and the SSE JSON payload must both match this shape). */
export type QueueDecision = Omit<
  DecisionRow,
  'proposed_at' | 'decided_at' | 'executed_at' | 'undo_expires_at' | 'cancelled_at'
> & {
  proposed_at: string;
  decided_at: string | null;
  executed_at: string | null;
  undo_expires_at: string | null;
  cancelled_at: string | null;
};

export function serializeDecision(d: DecisionRow): QueueDecision {
  return {
    ...d,
    proposed_at: d.proposed_at.toISOString(),
    decided_at: d.decided_at?.toISOString() ?? null,
    executed_at: d.executed_at?.toISOString() ?? null,
    undo_expires_at: d.undo_expires_at?.toISOString() ?? null,
    cancelled_at: d.cancelled_at?.toISOString() ?? null,
  };
}
