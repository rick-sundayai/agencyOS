import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { getEnv } from '../../src/lib/env';

async function main() {
  const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
  const orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id as string;
  const one = async (q: ReturnType<typeof sql>) => Number((await q)[0].n);

  const candidates = await one(sql`select count(*)::int as n from candidates where org_id=${orgId} and jobdiva_id is not null`);
  const jobs = await one(sql`select count(*)::int as n from job_orders where org_id=${orgId} and jobdiva_id is not null`);
  const clients = await one(sql`select count(*)::int as n from clients where org_id=${orgId}`);
  const withResume = await one(sql`
    select count(distinct cd.candidate_id)::int as n from candidate_documents cd
    join candidates c on c.id = cd.candidate_id where c.org_id=${orgId} and c.jobdiva_id is not null`);
  const embeddedDocs = await one(sql`
    select count(distinct e.subject_id)::int as n from embeddings e
    where e.org_id=${orgId} and e.subject_type='candidate_document'`);
  const noResume = await sql`
    select c.full_name, c.jobdiva_id from candidates c
    where c.org_id=${orgId} and c.jobdiva_id is not null
      and not exists (select 1 from candidate_documents d where d.candidate_id=c.id)
    order by c.full_name limit 200`;
  // Mirror backfill-embeddings.ts exactly: latest version, has text, candidate_document
  // subject type — otherwise superseded resume versions show as permanently un-embedded
  // and the report can never converge.
  const noEmbedding = await sql`
    select c.full_name from candidates c
    join candidate_documents d on d.candidate_id=c.id
    where c.org_id=${orgId}
      and d.parsed_text is not null
      and d.version = (select max(v.version) from candidate_documents v where v.candidate_id = d.candidate_id)
      and not exists (select 1 from embeddings e where e.subject_id=d.id and e.subject_type='candidate_document')
    group by c.full_name order by c.full_name limit 200`;
  const checkpoints = await sql`select source, watermark from migration_checkpoints where org_id=${orgId}`;

  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# JobDiva migration reconciliation — ${date}`, '',
    `| Metric | Count |`, `|---|---|`,
    `| Candidates (jobdiva_id set) | ${candidates} |`,
    `| Candidates with a resume document | ${withResume} |`,
    `| Resume documents embedded | ${embeddedDocs} |`,
    `| Job orders (jobdiva_id set) | ${jobs} |`,
    `| Clients | ${clients} |`, '',
    `## Checkpoints`, ...checkpoints.map((c) => `- ${c.source}: ${c.watermark}`), '',
    `## Candidates without a resume (${noResume.length}${noResume.length === 200 ? '+, truncated' : ''})`,
    ...noResume.map((r) => `- ${r.full_name} (jobdiva ${r.jobdiva_id})`), '',
    `## Candidates whose latest resume is not embedded (${noEmbedding.length})`,
    ...noEmbedding.map((r) => `- ${r.full_name}`), '',
    `Compare the candidate/job counts against JobDiva's own record counts before declaring cutover.`,
  ];
  const path = `docs/migration-report_${date}.md`;
  writeFileSync(path, lines.join('\n'));
  console.log('wrote', path);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
