import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { decisions, scores, sourcing_runs } from '../db/schema';

export type SourcingPhase =
  | 'queued' | 'searching_pool' | 'checking_jobdiva' | 'embedding_new'
  | 'shortlisting' | 'screening' | 'done' | 'failed';

export const TERMINAL_PHASES: ReadonlySet<SourcingPhase> = new Set(['done', 'failed']);

/** A non-terminal run untouched this long is presumed dead (n8n crashed before its
 * failure handler could run) and is persisted to 'failed' on read. */
export const STALE_MINUTES = 10;

export type SourcingRunRow = typeof sourcing_runs.$inferSelect;

const TERMINAL = ['done', 'failed'] as const;

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
      dsql`${sourcing_runs.phase} not in ('done', 'failed')`,
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
  patch: { phase?: SourcingPhase; stats?: Record<string, unknown>; error?: string | null },
): Promise<SourcingRunRow | null> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.phase !== undefined) set.phase = patch.phase;
  if (patch.error !== undefined) set.error = patch.error;
  if (patch.stats !== undefined) {
    set.stats = dsql`${sourcing_runs.stats} || ${JSON.stringify(patch.stats)}::jsonb`;
  }
  const [row] = await db.update(sourcing_runs).set(set)
    .where(and(eq(sourcing_runs.org_id, orgId), eq(sourcing_runs.id, id)))
    .returning();
  return row ?? null;
}

export async function getLatestSourcingRun(
  orgId: string, jobOrderId: string,
): Promise<SourcingRunRow | null> {
  const [row] = await db.select().from(sourcing_runs).where(and(
    eq(sourcing_runs.org_id, orgId),
    eq(sourcing_runs.job_order_id, jobOrderId),
  )).orderBy(desc(sourcing_runs.created_at)).limit(1);
  if (!row) return null;

  const isTerminal = (TERMINAL as readonly string[]).includes(row.phase);
  const staleMs = STALE_MINUTES * 60_000;
  if (!isTerminal && Date.now() - row.updated_at.getTime() > staleMs) {
    return updateSourcingRun(orgId, row.id, {
      phase: 'failed', error: 'Sourcing run timed out — the agent runtime stopped reporting progress.',
    });
  }
  return row;
}

export type ShortlistEntry = {
  candidate_id: string;
  full_name: string;
  current_title: string | null;
  distance: number;
  fit_rating: string | null;
};

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

  const ranked = (d.payload as { ranked?: Array<{
    candidate_id: string; full_name: string; current_title: string | null; distance: number;
  }> }).ranked ?? [];
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
