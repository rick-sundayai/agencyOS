import { db } from '../db/client';
import { applications } from '../db/schema';

/** Shortlist → pipeline: every shortlisted candidate becomes a 'sourced' Application.
 * Existing applications (any stage) are left untouched via the unique
 * (job_order_id, candidate_id) constraint. */
export async function upsertSourcedApplications(
  orgId: string, jobOrderId: string, candidateIds: string[],
): Promise<{ inserted: number }> {
  if (candidateIds.length === 0) return { inserted: 0 };
  const rows = await db.insert(applications)
    .values(candidateIds.map((candidate_id) => ({
      org_id: orgId, job_order_id: jobOrderId, candidate_id, stage: 'sourced',
    })))
    .onConflictDoNothing()
    .returning();
  return { inserted: rows.length };
}
