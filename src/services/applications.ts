import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { applications, candidates, job_orders } from '../db/schema';

/** Shortlist → pipeline: every shortlisted candidate becomes a 'sourced' Application.
 * Existing applications (any stage) are left untouched via the unique
 * (job_order_id, candidate_id) constraint.
 *
 * ADR-0006 tenant isolation: an agent key only carries its own org_id, but the
 * job order and candidate ids in the request body are caller-supplied and could
 * name rows from another org. Both are checked against orgId before any insert.
 * Returns null when jobOrderId isn't owned by orgId (mirrors the sibling
 * getJobOrder/updateSourcingRun null->404 idiom). Throws when any candidateId
 * isn't owned by orgId — the route maps that to 400, same pattern as the
 * message-matched throws in services/decision-store.ts. */
export async function upsertSourcedApplications(
  orgId: string, jobOrderId: string, candidateIds: string[],
): Promise<{ inserted: number } | null> {
  const [job] = await db.select({ id: job_orders.id }).from(job_orders)
    .where(and(eq(job_orders.org_id, orgId), eq(job_orders.id, jobOrderId)));
  if (!job) return null;

  if (candidateIds.length === 0) return { inserted: 0 };

  const owned = await db.select({ id: candidates.id }).from(candidates)
    .where(and(eq(candidates.org_id, orgId), inArray(candidates.id, candidateIds)));
  const ownedIds = new Set(owned.map((c) => c.id));
  if (!candidateIds.every((id) => ownedIds.has(id))) {
    throw new Error('Unknown candidate_ids for this org');
  }

  const rows = await db.insert(applications)
    .values(candidateIds.map((candidate_id) => ({
      org_id: orgId, job_order_id: jobOrderId, candidate_id, stage: 'sourced',
    })))
    .onConflictDoNothing()
    .returning();
  return { inserted: rows.length };
}
