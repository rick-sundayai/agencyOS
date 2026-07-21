import { z } from 'zod';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates, candidate_documents, embeddings } from '../db/schema';

export const CandidateIngestSchema = z.strictObject({
  org_id: z.uuid(),
  full_name: z.string().min(1),
  email: z.email().nullable().default(null),
  phone: z.string().nullable().default(null),
  current_title: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  source: z.string().nullable().default(null),
  resume_text: z.string().nullable().default(null),
  jobdiva_id: z.string().nullable().default(null),
});

export async function ingestCandidate(input: unknown): Promise<{
  candidate_id: string; document_id: string | null; deduped: boolean;
}> {
  const p = CandidateIngestSchema.parse(input);

  // The dedupe match is jobdiva_id (when present) or email-OR-phone, not one column, so a
  // DB unique constraint can't enforce it directly. Serialize concurrent ingests for the
  // same identity with an advisory lock (released automatically at transaction end)
  // instead — without it, two concurrent calls for the same person can both see "no
  // match" and both insert.
  return db.transaction(async (tx) => {
    const lockKey = p.jobdiva_id
      ? `${p.org_id}|jobdiva:${p.jobdiva_id}`
      : `${p.org_id}|${(p.email ?? p.phone ?? '').toLowerCase()}`;
    await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

    let existing: typeof candidates.$inferSelect | undefined;
    // jobdiva_id is an external, stable identifier — check it FIRST, before email/phone,
    // since those can legitimately change between sync runs while jobdiva_id stays fixed.
    if (p.jobdiva_id) {
      [existing] = await tx.select().from(candidates).where(and(
        eq(candidates.org_id, p.org_id), eq(candidates.jobdiva_id, p.jobdiva_id),
      ));
    }
    if (!existing && p.email) {
      [existing] = await tx.select().from(candidates).where(and(
        eq(candidates.org_id, p.org_id),
        dsql`lower(${candidates.email}) = lower(${p.email})`,
      ));
    }
    if (!existing && p.phone) {
      [existing] = await tx.select().from(candidates).where(and(
        eq(candidates.org_id, p.org_id), eq(candidates.phone, p.phone),
      ));
    }

    let candidateId: string;
    const deduped = !!existing;
    if (existing) {
      candidateId = existing.id;
      // Identity fields keep the existing value; profile fields prefer the fresher incoming value.
      await tx.update(candidates).set({
        email: existing.email ?? p.email,
        phone: existing.phone ?? p.phone,
        current_title: p.current_title ?? existing.current_title,
        location: p.location ?? existing.location,
        source: p.source ?? existing.source,
        jobdiva_id: existing.jobdiva_id ?? p.jobdiva_id,
      }).where(eq(candidates.id, existing.id));
    } else {
      const [row] = await tx.insert(candidates).values({
        org_id: p.org_id, full_name: p.full_name, email: p.email, phone: p.phone,
        current_title: p.current_title, location: p.location, source: p.source,
        jobdiva_id: p.jobdiva_id,
      }).returning();
      candidateId = row.id;
    }

    let documentId: string | null = null;
    if (p.resume_text) {
      const [{ maxV }] = await tx
        .select({ maxV: dsql<number>`coalesce(max(${candidate_documents.version}), 0)` })
        .from(candidate_documents)
        .where(eq(candidate_documents.candidate_id, candidateId));
      const version = Number(maxV) + 1;
      const [doc] = await tx.insert(candidate_documents).values({
        org_id: p.org_id, candidate_id: candidateId, kind: 'resume',
        storage_key: `ingest/${candidateId}/v${version}.txt`,
        parsed_text: p.resume_text, version,
      }).returning();
      documentId = doc.id;
    }

    return { candidate_id: candidateId, document_id: documentId, deduped };
  });
}

export const EmbeddingsUpsertSchema = z.strictObject({
  org_id: z.uuid(),
  subject_type: z.enum(['candidate_document', 'job_order']),
  subject_id: z.uuid(),
  chunks: z.array(z.strictObject({
    chunk_index: z.number().int().min(0),
    content: z.string().min(1),
    embedding: z.array(z.number()).length(3072),
    content_hash: z.string().min(1),
  })).min(1),
});

export async function upsertEmbeddings(input: unknown): Promise<{ inserted: number }> {
  const p = EmbeddingsUpsertSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.delete(embeddings).where(and(
      eq(embeddings.org_id, p.org_id),
      eq(embeddings.subject_type, p.subject_type),
      eq(embeddings.subject_id, p.subject_id),
    ));
    await tx.insert(embeddings).values(p.chunks.map((c) => ({
      org_id: p.org_id, subject_type: p.subject_type, subject_id: p.subject_id,
      chunk_index: c.chunk_index, content: c.content,
      embedding: c.embedding, content_hash: c.content_hash,
    })));
    return { inserted: p.chunks.length };
  });
}

/** Read back stored embedding chunks (e.g. so a re-source can reuse the job-order
 * embedding instead of re-calling the embedding API when content is unchanged).
 * halfvec comes back from postgres as a '[1,2,...]' string — parse it. */
export async function getStoredEmbeddings(
  orgId: string,
  subjectType: 'candidate_document' | 'job_order',
  subjectId: string,
): Promise<Array<{ chunk_index: number; content_hash: string; embedding: number[] }>> {
  const rows = await db.select({
    chunk_index: embeddings.chunk_index,
    content_hash: embeddings.content_hash,
    embedding: embeddings.embedding,
  }).from(embeddings).where(and(
    eq(embeddings.org_id, orgId),
    eq(embeddings.subject_type, subjectType),
    eq(embeddings.subject_id, subjectId),
  )).orderBy(embeddings.chunk_index);
  return rows.map((r) => ({
    chunk_index: r.chunk_index,
    content_hash: r.content_hash,
    embedding: typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding,
  }));
}
