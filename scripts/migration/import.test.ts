import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../../src/lib/env';
import { JobDivaClient } from './jobdiva-client';
import { runImport } from './run-import';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
const T = Date.now(); // unique jobdiva ids per test run

type Fake = { client: JobDivaClient; calls: { resumeDetail: number } };

function fakeClient(): Fake {
  const calls = { resumeDetail: 0 };
  const c = Object.create(JobDivaClient.prototype) as JobDivaClient;
  const data = {
    jobs: [{ ID: `J-${T}` }],
    jobDetail: { ID: `J-${T}`, JOBTITLE: 'Imported React Dev', COMPANYNAME: `Acme ${T}`,
      JOBDESCRIPTION: '<p>Build</p>', SKILLS: 'React, AWS' },
    cands: [{ ID: `C-${T}` }],
    candDetail: { ID: `C-${T}`, FIRSTNAME: 'Import', LASTNAME: `Test${T}`,
      EMAIL: `import-${T}@example.com`, CELLPHONE: '555-1', CITY: 'NYC' },
    resumes: [{ RESUMEID: `R-${T}`, DATERECEIVED: '2026-01-01' }],
    resume: { PLAINTEXT: 'React developer resume text for import test.' },
  };
  c.newUpdatedJobRecords = async () => ({ data: data.jobs });
  c.jobDetail = async () => ({ data: [data.jobDetail] });
  c.newUpdatedCandidateRecords = async () => ({ data: data.cands });
  c.candidateDetail = async () => ({ data: [data.candDetail] });
  c.candidateResumes = async () => ({ data: data.resumes });
  c.resumeDetail = async () => { calls.resumeDetail++; return { data: [data.resume] }; };
  return { client: c, calls };
}

// The runner's watermark rows are keyed on (org_id, source) — the SAME rows a real
// import reads. Clear them around tests so (a) re-run tests actually re-execute the
// window loop and exercise the hash dedupe rather than the checkpoint skip, and
// (b) test runs never advance the real watermark and silently truncate a later
// real import (a test-polluted watermark at 2026-01-31 would make a real
// --since 2015-01-01 run skip a decade of history).
async function clearCheckpoints() {
  await sql`delete from migration_checkpoints where org_id = ${orgId} and source like 'jobdiva-%'`;
}

// Without this, the candidate/job/client rows created below pile up in the DB across
// separate test invocations (no cleanup happens between process runs, unlike the
// checkpoint clearing above). The fake client's CELLPHONE is a constant ('555-1', not
// templated by T), so ingestCandidate's phone-based dedupe fallback silently merges a
// fresh run's candidate into whatever stale row a *previous* run left behind — freezing
// full_name at the first run's value and making assertions on it flaky (same class of
// bug fixed for matching.test.ts in 40db488). Delete only rows tagged with this test's
// synthetic id conventions ('J-'/'C-' prefixes, phone '555-1', 'Acme ' client names —
// none of which collide with real JobDiva ids or other suites' fixtures), in FK order
// (candidate_documents before candidates; job_orders before clients).
async function clearFixtures() {
  const candidateIds = (await sql`select id from candidates where org_id = ${orgId} and phone = '555-1'`)
    .map((r) => r.id as string);
  if (candidateIds.length > 0) {
    await sql`delete from candidate_documents where candidate_id in ${sql(candidateIds)}`;
    await sql`delete from candidates where id in ${sql(candidateIds)}`;
  }
  await sql`delete from job_orders where org_id = ${orgId} and jobdiva_id like 'J-%'`;
  await sql`delete from clients where org_id = ${orgId} and name like 'Acme %'`;
}

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  await clearCheckpoints();
  await clearFixtures();
});
afterAll(async () => {
  await clearCheckpoints();
  await clearFixtures();
});

describe('runImport', () => {
  it('imports job (with client), candidate, and resume', async () => {
    const { client } = fakeClient();
    const r = await runImport({ orgId, since: '2026-01-01', until: '2026-01-31', dryRun: false, client });
    expect(r.jobs).toBe(1);
    expect(r.candidates).toBe(1);
    expect(r.resumes).toBe(1);

    const [job] = await sql`select title, client_id from job_orders where org_id = ${orgId} and jobdiva_id = ${'J-' + T}`;
    expect(job.title).toBe('Imported React Dev');
    expect(job.client_id).not.toBeNull();
    const [cand] = await sql`select id, full_name from candidates where org_id = ${orgId} and jobdiva_id = ${'C-' + T}`;
    expect(cand.full_name).toBe(`Import Test${T}`);
    const [{ n }] = await sql`select count(*)::int as n from candidate_documents where candidate_id = ${cand.id}`;
    expect(n).toBe(1);
  });

  it('re-run with a cleared checkpoint re-processes but dedupes (resume hash + jobdiva upserts)', async () => {
    await clearCheckpoints(); // force the window loop to run again — this test targets the dedupe, not the checkpoint skip
    const { client, calls } = fakeClient();
    const r = await runImport({ orgId, since: '2026-01-01', until: '2026-01-31', dryRun: false, client });
    expect(calls.resumeDetail).toBe(1); // proves the loop executed and re-fetched the resume
    expect(r.resumes).toBe(0);          // …but the unchanged hash skipped the re-ingest
    const [cand] = await sql`select id from candidates where org_id = ${orgId} and jobdiva_id = ${'C-' + T}`;
    const [{ n }] = await sql`select count(*)::int as n from candidate_documents where candidate_id = ${cand.id}`;
    expect(n).toBe(1); // no version bump
    const [{ j }] = await sql`select count(*)::int as j from job_orders where org_id = ${orgId} and jobdiva_id = ${'J-' + T}`;
    expect(j).toBe(1);
  });

  it('checkpoint watermark skips already-processed windows entirely', async () => {
    const { client, calls } = fakeClient(); // previous test advanced the watermark to 2026-01-31
    const r = await runImport({ orgId, since: '2026-01-01', until: '2026-01-31', dryRun: false, client });
    expect(calls.resumeDetail).toBe(0); // zero windows computed — nothing fetched
    expect(r.candidates).toBe(0);
  });

  it('dry-run writes nothing', async () => {
    const before = (await sql`select count(*)::int as n from candidates where org_id = ${orgId}`)[0].n;
    const { client } = fakeClient();
    // new ids so nothing matches existing rows
    client.newUpdatedCandidateRecords = async () => ({ data: [{ ID: `C-dry-${T}` }] });
    client.candidateDetail = async () => ({ data: [{ ID: `C-dry-${T}`, FIRSTNAME: 'Dry', LASTNAME: 'Run' }] });
    await runImport({ orgId, since: '2026-01-01', until: '2026-01-31', dryRun: true, client });
    const after = (await sql`select count(*)::int as n from candidates where org_id = ${orgId}`)[0].n;
    expect(after).toBe(before);
  });
});
