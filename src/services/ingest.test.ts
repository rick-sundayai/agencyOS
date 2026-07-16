import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { ingestCandidate, upsertEmbeddings } from './ingest';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
const email = `ingest-${Date.now()}@example.com`;

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
});

const vec = () => { const v = new Array(3072).fill(0); v[0] = 1; return v; };

describe('ingestCandidate', () => {
  it('creates a new candidate with a v1 resume document', async () => {
    const r = await ingestCandidate({
      org_id: orgId, full_name: 'Ingest One', email,
      current_title: 'React Developer', resume_text: 'resume v1 text',
    });
    expect(r.deduped).toBe(false);
    expect(r.document_id).not.toBeNull();
  });

  it('dedupes on email, fills phone, bumps the document version', async () => {
    const r = await ingestCandidate({
      org_id: orgId, full_name: 'Ingest One', email: email.toUpperCase(),
      phone: '+15550001111', resume_text: 'resume v2 text',
    });
    expect(r.deduped).toBe(true);
    const [doc] = await sql`
      select version from candidate_documents where id = ${r.document_id} `;
    expect(doc.version).toBe(2);
    const [cand] = await sql`select phone from candidates where id = ${r.candidate_id}`;
    expect(cand.phone).toBe('+15550001111');
  });

  it('serializes concurrent ingests for the same identity — no duplicate candidates', async () => {
    const raceEmail = `race-${Date.now()}@example.com`;
    const [a, b] = await Promise.all([
      ingestCandidate({ org_id: orgId, full_name: 'Race One', email: raceEmail }),
      ingestCandidate({ org_id: orgId, full_name: 'Race Two', email: raceEmail }),
    ]);
    expect(a.candidate_id).toBe(b.candidate_id);
    const [{ n }] = await sql`select count(*)::int as n from candidates where lower(email) = lower(${raceEmail})`;
    expect(n).toBe(1);
  });
});

describe('upsertEmbeddings', () => {
  it('replaces prior chunks for the subject (refresh semantics)', async () => {
    const { document_id } = await ingestCandidate({
      org_id: orgId, full_name: 'Embed Target',
      email: `embed-${Date.now()}@example.com`, resume_text: 'text',
    });
    const chunk = { chunk_index: 0, content: 'text', embedding: vec(), content_hash: 'h1' };
    await upsertEmbeddings({ org_id: orgId, subject_type: 'candidate_document', subject_id: document_id, chunks: [chunk] });
    await upsertEmbeddings({ org_id: orgId, subject_type: 'candidate_document', subject_id: document_id, chunks: [chunk, { ...chunk, chunk_index: 1, content_hash: 'h2' }] });
    const [{ n }] = await sql`select count(*)::int as n from embeddings where subject_id = ${document_id}`;
    expect(n).toBe(2);
  });

  it('rejects wrong dimensionality', async () => {
    await expect(upsertEmbeddings({
      org_id: orgId, subject_type: 'candidate_document',
      subject_id: '00000000-0000-7000-8000-000000000001',
      chunks: [{ chunk_index: 0, content: 'x', embedding: [1, 2, 3], content_hash: 'h' }],
    })).rejects.toThrow();
  });
});
