import { and, desc, eq, inArray, notInArray, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { decisions, scores, sourcing_runs } from '../db/schema';
import {
  type SourcingPhase, type SourcingStats, type RankedCandidate,
  isTerminalPhase, TERMINAL_PHASES, ShortlistPayloadSchema,
} from '../contracts/sourcing';

// Terminal-set membership for SQL predicates, derived from the contract rather than a raw
// `not in ('done','failed')` literal — the DB-side echo of isTerminalPhase().
const notTerminal = notInArray(sourcing_runs.phase, [...TERMINAL_PHASES]);

/** A non-terminal run untouched this long is presumed dead (n8n crashed before its
 * failure handler could run) and is persisted to 'failed' on read. */
export const STALE_MINUTES = 10;

export type SourcingRunRow = typeof sourcing_runs.$inferSelect;

export async function createSourcingRun(input: {
  org_id: string; job_order_id: string; requested_by: string | null;
}): Promise<{ created: true; run: SourcingRunRow } | { created: false; active: SourcingRunRow }> {
  // Advisory lock serializes concurrent Source clicks for the same job — without it,
  // two clicks can both see "no active run" and both insert.
  return db.transaction(async (tx) => {
    const lockKey = `${input.org_id}|sourcing:${input.job_order_id}`;
    await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const [active] = await tx.select().from(sourcing_runs).where(and(
      eq(sourcing_runs.org_id, input.org_id),
      eq(sourcing_runs.job_order_id, input.job_order_id),
      notTerminal,
    )).orderBy(desc(sourcing_runs.created_at)).limit(1);
    if (active) return { created: false as const, active };

    const [run] = await tx.insert(sourcing_runs).values({
      org_id: input.org_id, job_order_id: input.job_order_id,
      requested_by: input.requested_by,
    }).returning();
    return { created: true as const, run };
  });
}

export async function updateSourcingRun(
  orgId: string, id: string,
  patch: { phase?: SourcingPhase; stats?: SourcingStats; error?: string | null },
): Promise<SourcingRunRow | null> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.phase !== undefined) set.phase = patch.phase;
  if (patch.error !== undefined) set.error = patch.error;
  if (patch.stats !== undefined) {
    set.stats = dsql`${sourcing_runs.stats} || ${JSON.stringify(patch.stats)}::jsonb`;
  }
  // A terminal run is final. Guard the write with a compare-and-swap on phase so a straggler
  // PATCH (or the staleness sweep racing n8n's own failure report) can't resurrect a
  // done/failed run — same principle as ADR-0003's CAS on decisions.state.
  const [row] = await db.update(sourcing_runs).set(set).where(and(
    eq(sourcing_runs.org_id, orgId), eq(sourcing_runs.id, id), notTerminal,
  )).returning();
  if (row) return row;

  // No row updated: either the run doesn't exist (→ null, a real not-found) or it's already
  // terminal, in which case the update is a benign no-op — echo the frozen run unchanged.
  const [existing] = await db.select().from(sourcing_runs).where(and(
    eq(sourcing_runs.org_id, orgId), eq(sourcing_runs.id, id),
  ));
  return existing ?? null;
}

export async function getLatestSourcingRun(
  orgId: string, jobOrderId: string,
): Promise<SourcingRunRow | null> {
  const [row] = await db.select().from(sourcing_runs).where(and(
    eq(sourcing_runs.org_id, orgId),
    eq(sourcing_runs.job_order_id, jobOrderId),
  )).orderBy(desc(sourcing_runs.created_at)).limit(1);
  if (!row) return null;

  const isTerminal = isTerminalPhase(row.phase);
  const staleMs = STALE_MINUTES * 60_000;
  if (!isTerminal && Date.now() - row.updated_at.getTime() > staleMs) {
    return updateSourcingRun(orgId, row.id, {
      phase: 'failed', error: 'Sourcing run timed out — the agent runtime stopped reporting progress.',
    });
  }
  return row;
}

export type ShortlistEntry = RankedCandidate & { fit_rating: string | null };

/** The recruiter-facing shortlist: the latest executed source.shortlist decision's
 * ranked payload, decorated with the latest screening fit per candidate. */
export async function getSourcingShortlist(
  orgId: string, jobOrderId: string,
): Promise<ShortlistEntry[] | null> {
  const [d] = await db.select().from(decisions).where(and(
    eq(decisions.org_id, orgId),
    eq(decisions.job_order_id, jobOrderId),
    eq(decisions.action_class, 'source.shortlist'),
    eq(decisions.state, 'executed'),
  )).orderBy(desc(decisions.proposed_at)).limit(1);
  if (!d) return null;

  // Parse the payload rather than assert its type; a malformed payload degrades to an empty
  // shortlist so one bad Decision never 500s the recruiter's poll.
  const parsed = ShortlistPayloadSchema.safeParse(d.payload);
  const ranked = parsed.success ? parsed.data.ranked : [];
  if (ranked.length === 0) return [];

  const scoreRows = await db.select({
    candidate_id: scores.candidate_id, fit_rating: scores.fit_rating, created_at: scores.created_at,
  }).from(scores).where(and(
    eq(scores.org_id, orgId), eq(scores.job_order_id, jobOrderId),
    inArray(scores.candidate_id, ranked.map((r) => r.candidate_id)),
  ));
  const latestFit = new Map<string, { at: Date; fit: string }>();
  for (const s of scoreRows) {
    const prev = latestFit.get(s.candidate_id);
    if (!prev || s.created_at > prev.at) latestFit.set(s.candidate_id, { at: s.created_at, fit: s.fit_rating });
  }
  return ranked.map((r) => ({
    ...r, fit_rating: latestFit.get(r.candidate_id)?.fit ?? null,
  }));
}
