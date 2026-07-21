import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates, candidate_documents } from '../db/schema';
import { ingestCandidate, upsertEmbeddings } from './ingest';
import { updateSourcingRun } from './sourcing-runs';
import { getJobOrder } from './matching';
import type { EmbedFn } from './embed';
import type { JobDivaClient } from './jobdiva';

/** Hard cap on JobDiva resume fetches per run — one thin job must not trigger
 * hundreds of resume pulls. */
export const RESUME_FETCH_CAP = 25;

// Mirrors the n8n helpers' chunker so app-side and workflow-side embeddings agree.
function chunkText(text: string, size = 1500, overlap = 200): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function importCandidatesForJob(
  input: { org_id: string; job_order_id: string; sourcing_run_id?: string | null },
  deps: { jobdiva: JobDivaClient; embed: EmbedFn },
): Promise<{ jobdiva_found: number; jobdiva_new: number; embedded: number; skipped: number }> {
  const job = await getJobOrder(input.org_id, input.job_order_id);
  if (!job) throw new Error(`job order not found: ${input.job_order_id}`);

  const runId = input.sourcing_run_id ?? null;
  const hits = await deps.jobdiva.searchCandidates({
    title: job.title,
    mustHaves: (job.must_haves as string[] | null) ?? [],
  });
  if (runId) {
    await updateSourcingRun(input.org_id, runId, {
      phase: 'embedding_new', stats: { jobdiva_found: hits.length },
    });
  }

  // Resume fetches are the expensive JobDiva call: only candidates that are unknown,
  // or known but resume-less, get one (capped).
  const knownRows = hits.length === 0 ? [] : await db.select({
    id: candidates.id, jobdiva_id: candidates.jobdiva_id,
  }).from(candidates).where(and(
    eq(candidates.org_id, input.org_id),
    inArray(candidates.jobdiva_id, hits.map((h) => h.jobdiva_id)),
  ));
  const knownIds = knownRows.map((r) => r.id);
  const docRows = knownIds.length === 0 ? [] : await db.select({
    candidate_id: candidate_documents.candidate_id,
  }).from(candidate_documents).where(and(
    eq(candidate_documents.org_id, input.org_id),
    inArray(candidate_documents.candidate_id, knownIds),
  ));
  const knownByJd = new Map(knownRows.map((r) => [r.jobdiva_id, r.id]));
  const hasDoc = new Set(docRows.map((r) => r.candidate_id));

  let jobdiva_new = 0, embedded = 0, skipped = 0, resumeFetches = 0;
  for (const hit of hits) {
    try {
      const knownId = knownByJd.get(hit.jobdiva_id);
      const needsResume = !knownId || !hasDoc.has(knownId);
      let resumeText: string | null = null;
      if (needsResume && resumeFetches < RESUME_FETCH_CAP) {
        resumeFetches++;
        resumeText = await deps.jobdiva.getResumeText(hit.jobdiva_id);
      }

      const res = await ingestCandidate({
        org_id: input.org_id, full_name: hit.full_name, email: hit.email,
        phone: hit.phone, current_title: hit.current_title, location: hit.location,
        source: 'jobdiva', jobdiva_id: hit.jobdiva_id, resume_text: resumeText,
      });
      if (!res.deduped) jobdiva_new++;

      if (res.document_id && resumeText) {
        const chunks = chunkText(resumeText);
        const vectors = await Promise.all(chunks.map((c) => deps.embed(c)));
        await upsertEmbeddings({
          org_id: input.org_id, subject_type: 'candidate_document', subject_id: res.document_id,
          chunks: chunks.map((content, i) => ({
            chunk_index: i, content, embedding: vectors[i], content_hash: sha256(content),
          })),
        });
        embedded++;
      }
    } catch {
      // One bad candidate must not sink the batch — same isolation philosophy as
      // screening's per-candidate try/catch.
      skipped++;
    }
  }

  const out = { jobdiva_found: hits.length, jobdiva_new, embedded, skipped };
  if (runId) await updateSourcingRun(input.org_id, runId, { stats: out });
  return out;
}
