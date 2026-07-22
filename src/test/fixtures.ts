import postgres from 'postgres';
import { getEnv } from '../lib/env';

export type AtsFixtures = {
  orgId: string;
  tag: string;
  clientId: string;
  jobId: string;
  cand1: string; // has application (sourced), score, resume document
  cand2: string; // has application (screened)
};

export async function makeAtsFixtures(): Promise<AtsFixtures> {
  const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
  const tag = `fixture-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // A fresh, isolated org — not the shared 'Sunday AI Work' dev-seed org — so assertions
  // like "this stage has zero applications" hold regardless of what `db:reseed` or other
  // fixtures have put in that shared org. Same isolation pattern as seedTestAgentInFreshOrg.
  const orgId = (await sql`
    insert into orgs (name) values (${'Org ' + tag}) returning id`)[0].id as string;

  const [client] = await sql`
    insert into clients (org_id, name) values (${orgId}, ${'Client ' + tag}) returning id`;
  const [job] = await sql`
    insert into job_orders (org_id, client_id, title, kind)
    values (${orgId}, ${client.id}, ${'Job ' + tag}, 'contract') returning id`;
  const [cand1] = await sql`
    insert into candidates (org_id, full_name, email, current_title)
    values (${orgId}, ${'Cand A ' + tag}, ${tag + '-a@example.com'}, 'React Developer') returning id`;
  const [cand2] = await sql`
    insert into candidates (org_id, full_name, email, current_title)
    values (${orgId}, ${'Cand B ' + tag}, ${tag + '-b@example.com'}, 'Node Developer') returning id`;
  await sql`
    insert into applications (org_id, job_order_id, candidate_id, stage)
    values (${orgId}, ${job.id}, ${cand1.id}, 'sourced')`;
  await sql`
    insert into applications (org_id, job_order_id, candidate_id, stage)
    values (${orgId}, ${job.id}, ${cand2.id}, 'screened')`;
  // Older score for cand1, explicitly backdated — proves getJobOrderPipeline picks the
  // latest score by created_at rather than an arbitrary/first-inserted one.
  await sql`
    insert into scores (org_id, job_order_id, candidate_id, prompt_version, model, fit_rating, weighted_score, created_at)
    values (${orgId}, ${job.id}, ${cand1.id}, 'v2.1.0', 'gemini-2.5-flash', 'no', 0.12, now() - interval '2 days')`;
  await sql`
    insert into scores (org_id, job_order_id, candidate_id, prompt_version, model, fit_rating, weighted_score)
    values (${orgId}, ${job.id}, ${cand1.id}, 'v2.2.0', 'gemini-2.5-flash', 'yes', 0.87)`;
  await sql`
    insert into candidate_documents (org_id, candidate_id, kind, storage_key, parsed_text)
    values (${orgId}, ${cand1.id}, 'resume', ${'dev/resumes/' + tag + '.pdf'}, 'resume text')`;
  await sql.end();

  return {
    orgId,
    tag,
    clientId: client.id as string,
    jobId: job.id as string,
    cand1: cand1.id as string,
    cand2: cand2.id as string,
  };
}
