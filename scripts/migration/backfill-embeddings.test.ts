import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../../src/lib/env';
import { ingestCandidate } from '../../src/services/ingest';
import { backfillEmbeddings } from './backfill-embeddings';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
let candidateId: string;
let documentId: string;

const fakeEmbed = async () => { const v = new Array(3072).fill(0); v[0] = 1; return v; };

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  const r = await ingestCandidate({
    org_id: orgId, full_name: 'Backfill Target',
    email: `backfill-${Date.now()}@example.com`,
    resume_text: 'resume text '.repeat(200), // > 1 chunk
  });
  candidateId = r.candidate_id;
  documentId = r.document_id!;
});

// Without this, the candidate created above piles up in the DB across runs (no
// cleanup happens between test invocations), and eventually the accumulated
// "Backfill Target" rows interfere with test assertions. Delete only what this
// run created, in FK order (embeddings/candidate_documents reference candidates
// with no ON DELETE CASCADE), so other suites' data is untouched.
afterAll(async () => {
  const candidateIds = [candidateId];
  const documentIds = [documentId];
  if (documentIds.length > 0) {
    await sql`delete from embeddings where subject_type = 'candidate_document' and subject_id in ${sql(documentIds)}`;
  }
  await sql`delete from candidate_documents where candidate_id in ${sql(candidateIds)}`;
  await sql`delete from candidates where id in ${sql(candidateIds)}`;
});

describe('backfillEmbeddings', () => {
  it('embeds documents lacking vectors, then skips them on re-run', async () => {
    const first = await backfillEmbeddings({ orgId, embedFn: fakeEmbed });
    expect(first.embedded).toBeGreaterThanOrEqual(1);
    const [{ n }] = await sql`select count(*)::int as n from embeddings where subject_id = ${documentId}`;
    expect(n).toBeGreaterThanOrEqual(2); // multiple chunks

    const again = await backfillEmbeddings({ orgId, embedFn: fakeEmbed });
    const stillMine = (await sql`select count(*)::int as n from embeddings where subject_id = ${documentId}`)[0].n;
    expect(stillMine).toBe(n); // unchanged
    expect(again.embedded).toBe(0);
  });
});
