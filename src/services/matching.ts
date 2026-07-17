import { z } from 'zod';
import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates, candidate_documents, job_orders, scores } from '../db/schema';

export async function searchCandidatesByEmbedding(
  orgId: string, queryEmbedding: number[], limit = 10,
): Promise<Array<{ candidate_id: string; full_name: string; current_title: string | null; distance: number }>> {
  const vec = `[${queryEmbedding.join(',')}]`;
  const rows = await db.execute(dsql`
    select c.id as candidate_id, c.full_name, c.current_title,
           min(e.embedding <=> ${vec}::halfvec(3072)) as distance
    from embeddings e
    join candidate_documents d on d.id = e.subject_id
    join candidates c on c.id = d.candidate_id
    where e.org_id = ${orgId} and e.subject_type = 'candidate_document'
    group by c.id, c.full_name, c.current_title
    order by distance asc
    limit ${limit}`);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    candidate_id: r.candidate_id as string,
    full_name: r.full_name as string,
    current_title: (r.current_title as string) ?? null,
    distance: Number(r.distance),
  }));
}

export type JobOrderRow = typeof job_orders.$inferSelect;

export async function getJobOrder(orgId: string, id: string): Promise<JobOrderRow | null> {
  const [row] = await db.select().from(job_orders)
    .where(and(eq(job_orders.org_id, orgId), eq(job_orders.id, id)));
  return row ?? null;
}

export async function getCandidateWithResume(orgId: string, id: string) {
  const [cand] = await db.select().from(candidates)
    .where(and(eq(candidates.org_id, orgId), eq(candidates.id, id)));
  if (!cand) return null;
  const [doc] = await db.select().from(candidate_documents)
    .where(and(eq(candidate_documents.org_id, orgId), eq(candidate_documents.candidate_id, id)))
    .orderBy(desc(candidate_documents.version))
    .limit(1);
  return {
    candidate: cand,
    resume: doc ? { document_id: doc.id, parsed_text: doc.parsed_text } : null,
  };
}

export const ScoreInsertSchema = z.strictObject({
  org_id: z.uuid(),
  job_order_id: z.uuid(),
  candidate_id: z.uuid(),
  prompt_version: z.string().min(1),
  model: z.string().min(1),
  fit_rating: z.enum(['yes', 'borderline', 'no']),
  weighted_score: z.number().min(0).max(1).nullable().default(null),
  criteria: z.record(z.string(), z.unknown()).default({}),
});

export type ScoreRow = typeof scores.$inferSelect;

export async function insertScore(input: unknown): Promise<ScoreRow> {
  const p = ScoreInsertSchema.parse(input);
  const [row] = await db.insert(scores).values({
    ...p, weighted_score: p.weighted_score === null ? null : String(p.weighted_score),
  }).returning();
  return row;
}
