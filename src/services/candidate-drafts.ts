import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { candidate_documents } from '../db/schema';
import type { ObjectStore } from './storage';
import type { ResumeFile } from './resume-extract';
import type { PrefilledFields } from './resume-fields';
import { ingestCandidate, upsertEmbeddings } from './ingest';
import type { EmbedFn } from './embed';

export const stagingKey = (orgId: string, draftId: string) =>
  `staging/${orgId}/${draftId}`;
export const stagingTextKey = (orgId: string, draftId: string) =>
  `staging/${orgId}/${draftId}.txt`;

export type DraftDeps = {
  store: ObjectStore;
  extractText: (f: ResumeFile) => Promise<string>;
  extractFields: (text: string) => Promise<PrefilledFields>;
  newId: () => string;
};

export async function prepareCandidateDraft(
  orgId: string, file: ResumeFile, deps: DraftDeps,
): Promise<{ draft_id: string; fields: PrefilledFields; preview: string }> {
  const text = await deps.extractText(file);          // throws before any staging on bad file
  const fields = await deps.extractFields(text);
  const draftId = deps.newId();
  await deps.store.put(stagingKey(orgId, draftId), file.bytes, file.mime);
  await deps.store.put(
    stagingTextKey(orgId, draftId), new TextEncoder().encode(text), 'text/plain');
  return { draft_id: draftId, fields, preview: text.slice(0, 500) };
}

export const permanentKey = (orgId: string, candidateId: string, documentId: string) =>
  `resumes/${orgId}/${candidateId}/${documentId}`;

export type ConfirmFields = {
  full_name: string; email: string | null; phone: string | null;
  current_title: string | null; location: string | null;
};
export type ConfirmDeps = { store: ObjectStore; embed: EmbedFn };

export async function confirmCandidateDraft(
  orgId: string, draftId: string, fields: ConfirmFields, deps: ConfirmDeps,
): Promise<{ candidate_id: string; document_id: string | null;
             embedding_status: 'embedded' | 'failed' | 'pending' }> {
  const resumeText = await deps.store.getText(stagingTextKey(orgId, draftId));

  // Commit 1: the candidate + document. Reuses all dedupe/redact/format/chunk logic.
  const ingested = await ingestCandidate({
    org_id: orgId, full_name: fields.full_name, email: fields.email, phone: fields.phone,
    current_title: fields.current_title, location: fields.location,
    source: 'manual_upload', resume_text: resumeText,
  });

  if (!ingested.document_id) {
    return { candidate_id: ingested.candidate_id, document_id: null, embedding_status: 'pending' };
  }
  const documentId = ingested.document_id;

  // Commit 2: promote file + embed. Best-effort — failures here never undo commit 1.
  let status: 'embedded' | 'failed' | 'pending' = 'pending';
  try {
    const permKey = permanentKey(orgId, ingested.candidate_id, documentId);
    await deps.store.move(stagingKey(orgId, draftId), permKey);
    await db.update(candidate_documents)
      .set({ storage_key: permKey }).where(eq(candidate_documents.id, documentId));

    if (ingested.chunks.length > 0) {
      const chunks = [];
      for (let i = 0; i < ingested.chunks.length; i++) {
        const content = ingested.chunks[i];
        chunks.push({
          chunk_index: i, content, embedding: await deps.embed(content),
          content_hash: createHash('sha256').update(content).digest('hex'),
        });
      }
      await upsertEmbeddings({
        org_id: orgId, subject_type: 'candidate_document', subject_id: documentId, chunks,
      });
    }
    status = 'embedded';
  } catch {
    status = 'failed';
  }
  await db.update(candidate_documents)
    .set({ embedding_status: status }).where(eq(candidate_documents.id, documentId));

  return { candidate_id: ingested.candidate_id, document_id: documentId, embedding_status: status };
}
