import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { ingestCandidate, upsertEmbeddings } from './ingest';
import { searchCandidatesByEmbedding, getJobOrder, getCandidateWithResume, insertScore } from './matching';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
let near: { candidate_id: string; document_id: string | null };
let far: { candidate_id: string; document_id: string | null };
let jobId: string;

const axis = (i: number) => { const v = new Array(3072).fill(0); v[i] = 1; return v; };

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  const tag = Date.now();
  near = await ingestCandidate({ org_id: orgId, full_name: 'Near Match', email: `near-${tag}@example.com`, resume_text: 'react expert' });
  far = await ingestCandidate({ org_id: orgId, full_name: 'Far Match', email: `far-${tag}@example.com`, resume_text: 'accountant' });
  await upsertEmbeddings({ org_id: orgId, subject_type: 'candidate_document', subject_id: near.document_id, chunks: [{ chunk_index: 0, content: 'react expert', embedding: axis(0), content_hash: 'n' }] });
  await upsertEmbeddings({ org_id: orgId, subject_type: 'candidate_document', subject_id: far.document_id, chunks: [{ chunk_index: 0, content: 'accountant', embedding: axis(1), content_hash: 'f' }] });
  jobId = (await sql`
    insert into job_orders (org_id, title, description, kind, must_haves)
    values (${orgId}, 'Matching Test Job', 'React work', 'contract', '["React"]'::jsonb) returning id`)[0].id;
});

describe('searchCandidatesByEmbedding', () => {
  it('ranks the axis-aligned candidate first with ~0 distance', async () => {
    const results = await searchCandidatesByEmbedding(orgId, axis(0), 5);
    const nearHit = results.find((r) => r.candidate_id === near.candidate_id);
    const farHit = results.find((r) => r.candidate_id === far.candidate_id);
    expect(nearHit).toBeDefined();
    expect(nearHit!.distance).toBeLessThan(0.01);
    if (farHit) expect(farHit.distance).toBeGreaterThan(0.9);
    expect(results[0].candidate_id).toBe(near.candidate_id);
  });
});

describe('getJobOrder / getCandidateWithResume', () => {
  it('fetches the job order in-org, null cross-org', async () => {
    expect((await getJobOrder(orgId, jobId))?.title).toBe('Matching Test Job');
    expect(await getJobOrder('00000000-0000-7000-8000-000000000000', jobId)).toBeNull();
  });

  it('returns candidate with latest resume text', async () => {
    const r = await getCandidateWithResume(orgId, near.candidate_id);
    expect(r?.candidate.full_name).toBe('Near Match');
    expect(r?.resume?.parsed_text).toBe('react expert');
  });
});

describe('insertScore', () => {
  it('persists a score row with criteria breakdown', async () => {
    const s = await insertScore({
      org_id: orgId, job_order_id: jobId, candidate_id: near.candidate_id,
      prompt_version: 'v2.2.0', model: 'gemini-2.5-flash',
      fit_rating: 'yes', weighted_score: 0.87, criteria: { C01: { score: 5 } },
    });
    expect(s.id).toBeTruthy();
    expect(s.fit_rating).toBe('yes');
  });

  it('rejects an invalid fit_rating', async () => {
    await expect(insertScore({
      org_id: orgId, job_order_id: jobId, candidate_id: near.candidate_id,
      prompt_version: 'v', model: 'm', fit_rating: 'maybe',
    })).rejects.toThrow();
  });
});
