// THROWAWAY: pull a handful of real JobDiva resume PLAINTEXT samples to design
// the pre-embedding cleaning rules against reality. Not run in CI. Writes raw
// samples to a scratchpad dir (never the repo, never stdout) so PII stays out of
// logs/context; prints only structural stats.
// Usage: SAMPLE_OUT=/path/to/scratchpad npx tsx scripts/resume-sample-pull.ts <job-number> [count]
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultJobDivaClient } from '../src/services/jobdiva';

async function main() {
  const jobNumber = process.argv[2] ?? '23-00053';
  const count = Number(process.argv[3] ?? 5);
  const outDir = process.env.SAMPLE_OUT;
  if (!outDir) throw new Error('set SAMPLE_OUT to a scratchpad dir');

  const client = defaultJobDivaClient();
  const candidates = await client.searchCandidates(jobNumber, { resumeCount: 25 });
  console.log(`job ${jobNumber}: ${candidates.length} candidate hits`);

  let pulled = 0;
  for (const c of candidates) {
    if (pulled >= count) break;
    const text = await client.getResumeText(c.jobdiva_id);
    if (!text) continue;
    const file = join(outDir, `resume_${String(pulled).padStart(2, '0')}.txt`);
    writeFileSync(file, text, 'utf8');
    // Structural stats only — NO resume content to stdout.
    console.log({
      idx: pulled,
      chars: text.length,
      lines: text.split('\n').length,
      blank_line_runs: (text.match(/\n[ \t]*\n[ \t]*\n/g) ?? []).length,
      nbsp: (text.match(/ /g) ?? []).length,
      non_ascii: (text.match(/[^\x00-\x7f]/g) ?? []).length,
      hyphen_breaks: (text.match(/[a-z]-\n[a-z]/gi) ?? []).length,
    });
    pulled++;
  }
  console.log(`wrote ${pulled} sample(s) to ${outDir}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
