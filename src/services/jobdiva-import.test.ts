import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { candidates, candidate_documents, embeddings, job_orders } from '../db/schema';
import { seedTestAgentInFreshOrg } from '../test-support/seed-agent';
import { importCandidatesForJob } from './jobdiva-import';
import type { JobDivaClient, JobDivaCandidate } from './jobdiva';

const VEC = new Array(3072).fill(0.1);
const fakeEmbed = async () => VEC;

function fakeJobDiva(hits: JobDivaCandidate[], resumes: Record<string, string | null>): JobDivaClient {
  return {
    getJob: async () => null,
    searchCandidates: async () => hits,
    getResumeText: async (id) => resumes[id] ?? null,
  };
}

async function seedJob(orgId: string, jobdivaId: string | null = '23-00053'): Promise<string> {
  const [row] = await db.insert(job_orders).values({
    org_id: orgId, title: 'Rust Engineer', kind: 'contract',
    must_haves: ['Rust', 'gRPC'], jobdiva_id: jobdivaId,
  }).returning();
  return row.id;
}

const hit = (id: string, name: string): JobDivaCandidate => ({
  jobdiva_id: id, full_name: name, email: `${id}@x.test`, phone: null,
  current_title: 'Engineer', location: null,
});

describe('importCandidatesForJob', () => {
  it('ingests and embeds new candidates with resumes', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const jd = fakeJobDiva(
      [hit('jd-1', 'Ada L'), hit('jd-2', 'Grace H')],
      { 'jd-1': 'Ada resume: Rust, gRPC.', 'jd-2': null },
    );

    const out = await importCandidatesForJob(
      { org_id: orgId, job_order_id: jobId }, { jobdiva: jd, embed: fakeEmbed },
    );
    expect(out).toMatchObject({ jobdiva_found: 2, jobdiva_new: 2, embedded: 1 });

    const rows = await db.select().from(candidates).where(eq(candidates.org_id, orgId));
    expect(rows.map((r) => r.jobdiva_id).sort()).toEqual(['jd-1', 'jd-2']);
    const embRows = await db.select().from(embeddings).where(and(
      eq(embeddings.org_id, orgId), eq(embeddings.subject_type, 'candidate_document'),
    ));
    expect(embRows.length).toBeGreaterThanOrEqual(1);
  });

  it('skips resume fetch + embedding for known candidates that already have a document', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const [known] = await db.insert(candidates).values({
      org_id: orgId, full_name: 'Ada L', jobdiva_id: 'jd-1',
    }).returning();
    await db.insert(candidate_documents).values({
      org_id: orgId, candidate_id: known.id, storage_key: 'k', parsed_text: 'existing resume',
    });

    let resumeFetches = 0;
    const jd: JobDivaClient = {
      getJob: async () => null,
      searchCandidates: async () => [hit('jd-1', 'Ada L')],
      getResumeText: async () => { resumeFetches++; return 'new resume'; },
    };

    const out = await importCandidatesForJob(
      { org_id: orgId, job_order_id: jobId }, { jobdiva: jd, embed: fakeEmbed },
    );
    expect(resumeFetches).toBe(0);
    expect(out).toMatchObject({ jobdiva_found: 1, jobdiva_new: 0, embedded: 0 });
  });

  it('a bad candidate skips, the batch continues', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId);
    const bad: JobDivaCandidate = { ...hit('jd-9', ''), full_name: '' }; // fails ingest validation
    const jd = fakeJobDiva([bad, hit('jd-10', 'Grace H')], { 'jd-10': 'Grace resume' });

    const out = await importCandidatesForJob(
      { org_id: orgId, job_order_id: jobId }, { jobdiva: jd, embed: fakeEmbed },
    );
    expect(out.skipped).toBe(1);
    expect(out.jobdiva_new).toBe(1);
  });

  it('skips the JobDiva search entirely when the job has no jobdiva_id', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const jobId = await seedJob(orgId, null);
    const jd: JobDivaClient = {
      getJob: async () => null,
      searchCandidates: async () => { throw new Error('should not be called without a jobdiva_id'); },
      getResumeText: async () => null,
    };

    const out = await importCandidatesForJob(
      { org_id: orgId, job_order_id: jobId }, { jobdiva: jd, embed: fakeEmbed },
    );
    expect(out).toMatchObject({ jobdiva_found: 0, jobdiva_new: 0, embedded: 0, skipped: 0 });
  });

  it('throws when the job order does not exist in the org', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    await expect(importCandidatesForJob(
      { org_id: orgId, job_order_id: randomUUID() },
      { jobdiva: fakeJobDiva([], {}), embed: fakeEmbed },
    )).rejects.toThrow(/job order/i);
  });
});
