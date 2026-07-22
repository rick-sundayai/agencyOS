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

  const candidates = await client.searchCandidates(jobNumber);
  console.log(`searchCandidates: ${candidates.length} hits`);
  // Field presence only — candidate PII (email/phone/name values) must never be printed.
  console.log(candidates.slice(0, 3).map((c) => ({
    jobdiva_id: c.jobdiva_id,
    has_name: c.full_name !== '', has_email: c.email !== null, has_phone: c.phone !== null,
    has_title: c.current_title !== null, has_location: c.location !== null,
  })));

  if (candidates[0]) {
    const resume = await client.getResumeText(candidates[0].jobdiva_id);
    console.log('getResumeText length:', resume?.length ?? null);
  }

  if (candidates[0]) {
    const contact = await client.getCandidateContact(candidates[0].jobdiva_id);
    console.log('getCandidateContact:', { has_email: contact.email !== null, has_phone: contact.phone !== null });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
