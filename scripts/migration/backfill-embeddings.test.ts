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

// backfillEmbeddings is org-scoped: it embeds every latest-version resume doc in
// the org that lacks embeddings. Running against the shared 'Sunday AI Work' org
// makes this suite order-dependent — any test file that ingests a candidate into
// that org (e.g. makeAtsFixtures) leaves an unembedded document that the re-run
// assertion below then counts, flaking with "expected 2 to be +0". Give the suite
// its own throwaway org so the backfill only ever sees this suite's one document.
beforeAll(async () => {
  const [org] = await sql`
    insert into orgs (name) values (${`Backfill Test ${Date.now()}-${Math.floor(Math.random() * 1e6)}`}) returning id`;
  orgId = org.id;
  const r = await ingestCandidate({
    org_id: orgId, full_name: 'Backfill Target',
    email: `backfill-${Date.now()}@example.com`,
    resume_text: 'resume text '.repeat(200), // > 1 chunk
  });
  candidateId = r.candidate_id;
  documentId = r.document_id!;
});

// Tear down everything this suite created, in FK order (embeddings/candidate_documents/
// candidates reference their parents with no ON DELETE CASCADE), then drop the throwaway
// org. Scoped entirely to this org, so other suites' data is untouched.
afterAll(async () => {
  await sql`delete from embeddings where subject_type = 'candidate_document' and subject_id = ${documentId}`;
  await sql`delete from candidate_documents where candidate_id = ${candidateId}`;
  await sql`delete from candidates where id = ${candidateId}`;
  await sql`delete from orgs where id = ${orgId}`;
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
