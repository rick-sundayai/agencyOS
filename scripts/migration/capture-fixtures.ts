// One capped live pull to verify endpoint names, date format, and field names
// before the mapping layer is written. Output is gitignored (real PII).
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { JobDivaClient } from './jobdiva-client';

const DIR = 'scripts/migration/fixtures';

async function main() {
  mkdirSync(DIR, { recursive: true });
  const c = new JobDivaClient();

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const jobs = await c.newUpdatedJobRecords(from, to);
  writeFileSync(`${DIR}/new-updated-jobs.json`, JSON.stringify(jobs, null, 2));
  const jobRows = JobDivaClient.rows(jobs);
  if (jobRows[0]?.ID != null) {
    writeFileSync(`${DIR}/job-detail.json`,
      JSON.stringify(await c.jobDetail(String(jobRows[0].ID)), null, 2));
  }

  const cands = await c.newUpdatedCandidateRecords(from, to);
  writeFileSync(`${DIR}/new-updated-candidates.json`, JSON.stringify(cands, null, 2));
  const candRows = JobDivaClient.rows(cands);
  if (candRows[0]?.ID != null) {
    const id = String(candRows[0].ID);
    writeFileSync(`${DIR}/candidate-detail.json`, JSON.stringify(await c.candidateDetail(id), null, 2));
    const resumes = await c.candidateResumes(id);
    writeFileSync(`${DIR}/candidate-resumes.json`, JSON.stringify(resumes, null, 2));
    const r = JobDivaClient.rows(resumes)[0];
    const resumeId = r?.RESUMEID ?? r?.ID;
    if (resumeId != null) {
      writeFileSync(`${DIR}/resume-detail.json`,
        JSON.stringify(await c.resumeDetail(String(resumeId)), null, 2));
    }
  }
  console.log('fixtures written to', DIR);
}

main().catch((e) => { console.error(e); process.exit(1); });
