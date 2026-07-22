import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../../src/lib/env';
import { createFixtureOrg } from '../../src/test/fixtures';
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
  const candidateIds = (await sql`
    select id from candidates
    where org_id = ${orgId}
      and (phone = '555-1' or jobdiva_id like 'C-dup-%' or phone in ('555-9001', '555-9002'))`)
    .map((r) => r.id as string);
  if (candidateIds.length > 0) {
    await sql`delete from candidate_documents where candidate_id in ${sql(candidateIds)}`;
    await sql`delete from candidates where id in ${sql(candidateIds)}`;
  }
  await sql`delete from job_orders where org_id = ${orgId} and jobdiva_id like 'J-%'`;
  await sql`delete from clients where org_id = ${orgId} and name like 'Acme %'`;
}

beforeAll(async () => {
  orgId = await createFixtureOrg();
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

  it('re-import with same jobdiva_id but changed email/phone updates one row, not a duplicate', async () => {
    // Task-review fix: run-import.ts's `known` lookup (by jobdiva_id) previously fed only
    // the resume-hash watermark check — the actual ingestCandidate() call re-resolved
    // identity by email/phone alone, so a candidate whose email AND phone both change
    // between two JobDiva syncs (but whose jobdiva_id stays fixed) got silently
    // duplicated. ingestCandidate() now checks jobdiva_id first; this proves the runner
    // exercises that path end-to-end.
    const dupId = `C-dup-${T}`;
    await clearCheckpoints(); // force the window loop to run for both passes below

    const { client: client1 } = fakeClient();
    client1.newUpdatedCandidateRecords = async () => ({ data: [{ ID: dupId }] });
    client1.candidateDetail = async () => ({
      data: [{ ID: dupId, FIRSTNAME: 'Dup', LASTNAME: 'One', EMAIL: `dup-old-${T}@example.com`, CELLPHONE: '555-9001', CITY: 'NYC' }],
    });
    await runImport({ orgId, since: '2026-01-01', until: '2026-01-31', dryRun: false, client: client1 });

    await clearCheckpoints();
    const { client: client2 } = fakeClient();
    client2.newUpdatedCandidateRecords = async () => ({ data: [{ ID: dupId }] });
    client2.candidateDetail = async () => ({
      data: [{ ID: dupId, FIRSTNAME: 'Dup', LASTNAME: 'One', EMAIL: `dup-new-${T}@example.com`, CELLPHONE: '555-9002', CITY: 'NYC' }],
    });
    const r2 = await runImport({ orgId, since: '2026-01-01', until: '2026-01-31', dryRun: false, client: client2 });
    expect(r2.candidates).toBe(1);

    // Look up by the PHONE values used across both calls, not by jobdiva_id — under the
    // bug, a duplicate row created by the second call never gets jobdiva_id backfilled
    // (the `known` guard that used to do the backfill saw a truthy `known` from the first
    // call), so a query scoped to jobdiva_id alone would miss the duplicate and pass
    // regardless of the bug. This is the query that actually catches it.
    const rows = await sql`
      select id, jobdiva_id, phone from candidates
      where org_id = ${orgId} and phone in ('555-9001', '555-9002')`;
    expect(rows.length).toBe(1);
    // ingestCandidate() keeps identity fields (email/phone) sticky to the FIRST value seen
    // once matched via jobdiva_id — so the single surviving row still carries the original phone.
    expect(rows[0].phone).toBe('555-9001');
    expect(rows[0].jobdiva_id).toBe(dupId);
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
