// One-off manual check of the JobDiva client against the real API. Not run in CI.
// Usage: npx tsx scripts/jobdiva-smoke.ts <job-number>
import 'dotenv/config';
import { defaultJobDivaClient } from '../src/services/jobdiva';

async function main() {
  const jobNumber = process.argv[2];
  if (!jobNumber) throw new Error('usage: npx tsx scripts/jobdiva-smoke.ts <job-number>');
  const client = defaultJobDivaClient();

  const job = await client.getJob(jobNumber);
  console.log('getJob:', JSON.stringify(job, null, 2));
  if (!job) return;

  const candidates = await client.searchCandidates({ title: job.title, mustHaves: job.must_haves });
  console.log(`searchCandidates: ${candidates.length} hits`);
  console.log(JSON.stringify(candidates.slice(0, 3), null, 2));

  if (candidates[0]) {
    const resume = await client.getResumeText(candidates[0].jobdiva_id);
    console.log('getResumeText length:', resume?.length ?? null);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
