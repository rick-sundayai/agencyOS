import 'dotenv/config';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { ACTION_CLASSES } from '../contracts/decision';
import { getEnv } from '../lib/env';

// Wipes the local domain data and regenerates a realistic dataset: 10 clients,
// 10 job orders, 500 candidates, and pipeline applications + fit scores so the
// Control Room card UI (pipelines, fit rings, stat tiles) is fully populated.
// Foundation rows (org, admin user, autonomy policy, scorer prompts) are kept.
//
// Run: npm run db:reseed

const FIRST = [
  'Aisha', 'Liam', 'Noah', 'Priya', 'Mateo', 'Sofia', 'Ethan', 'Zara', 'Omar', 'Maya',
  'Lucas', 'Chen', 'Ava', 'Diego', 'Nina', 'Kofi', 'Yuki', 'Ravi', 'Elena', 'Jamal',
  'Grace', 'Hassan', 'Ingrid', 'Tariq', 'Amara', 'Felix', 'Lena', 'Sanjay', 'Rosa', 'Kai',
  'Bianca', 'Dmitri', 'Fatima', 'Oscar', 'Leila', 'Theo', 'Nadia', 'Pablo', 'Hana', 'Malik',
];
const LAST = [
  'Okafor', 'Nguyen', 'Patel', 'Garcia', 'Rossi', 'Kim', 'Johnson', 'Haddad', 'Silva', 'Cohen',
  'Mwangi', 'Tanaka', 'Novak', 'Reyes', 'Andersson', 'Osei', 'Khan', 'Fischer', 'Moreau', 'Costa',
  'Bauer', 'Ivanov', 'Santos', 'Wang', 'Dubois', 'Larsson', 'Mensah', 'Romano', 'Volkov', 'Ali',
  'Schneider', 'Park', 'Ferrari', 'Nowak', 'Abadi', 'Hansen', 'Sharma', 'Torres', 'Yamamoto', 'Ndiaye',
];
const TITLES = [
  'Software Engineer', 'Senior Software Engineer', 'Application Support Engineer',
  'Data Analyst', 'Supply Chain Analyst', 'Payroll Associate', 'Compliance Officer',
  'DevOps Engineer', 'Product Manager', 'Business Analyst', 'QA Engineer',
  'Solutions Architect', 'Project Coordinator', 'SAP Analyst', 'Systems Administrator',
];
const CITIES = [
  'Pittsburgh, PA, US', 'Chicago, IL, US', 'Lake Mary, FL, US', 'New York, NY, US',
  'Austin, TX, US', 'Seattle, WA, US', 'Denver, CO, US', 'Atlanta, GA, US',
  'Boston, MA, US', 'Phoenix, AZ, US', 'Columbus, OH, US', 'Charlotte, NC, US',
  'Dallas, TX, US', 'Sanford, FL, US', 'Cranberry Township, PA, US', 'Wheeling, IL, US',
];
const SOURCES = ['LinkedIn', 'Referral', 'JobDiva', 'Indeed', 'Inbound', 'Dice', 'Career site'];
const CLIENT_NAMES = [
  'BNY Mellon - Pontoon', 'Mondelez International - Kelly', 'Fluidra North America',
  'Sumitomo Mitsui Banking Corp.', 'US Bank', 'Medtronic', 'Goldman Sachs',
  'Abul Khair Steel', 'Walmart Global Tech', 'Amazon Web Services',
];
const JOB_TITLES = [
  'Payroll Associate - Non Exempt', 'Materials SAP Analyst', 'Application Support Engineer',
  'Compliance Officer IV', 'Supply Chain / Procurement Analyst', 'Production Support Engineer',
  'Senior Application Engineer', 'Third Party Governance Analyst', 'Process Engineer',
  'Data Platform Engineer',
];
const KINDS = ['contract', 'direct_hire'];
const SKILLS = [
  'SAP', 'Python', 'SQL', 'Java', 'AWS', 'Kubernetes', 'React', 'Payroll systems',
  'Procurement', 'Compliance', 'ETL', 'Snowflake', 'Terraform', 'ServiceNow',
  'Financial reporting', 'Risk assessment', 'Data modeling', 'Incident response',
];
const MODELS = ['gemini-2.5-flash', 'gpt-4o-mini', 'claude-haiku-4-5'];
const PROMPT_VERSIONS = ['v2.2.0', 'v2.3.0'];
// Weighted so most candidates sit in early stages, a few reach offer/placed.
const STAGE_WEIGHTS: Array<[string, number]> = [
  ['sourced', 30], ['screened', 22], ['submitted', 16], ['interviewing', 12],
  ['offer', 5], ['placed', 6], ['rejected', 9],
];
const FIT_RATINGS = ['yes', 'borderline', 'no'] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
/** n distinct random elements from arr. */
function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}
function weightedStage(): string {
  const total = STAGE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [stage, w] of STAGE_WEIGHTS) {
    if ((r -= w) <= 0) return stage;
  }
  return 'sourced';
}
/** A weighted_score (0–1) correlated with the fit rating. */
function scoreFor(fit: string): number {
  const [lo, hi] = fit === 'yes' ? [0.75, 0.98] : fit === 'borderline' ? [0.45, 0.7] : [0.08, 0.35];
  return Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
}
function phone(): string {
  return `+1 (${rand(200, 989)}) ${rand(200, 989)}-${String(rand(0, 9999)).padStart(4, '0')}`;
}

async function reseed() {
  const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
  try {
    // --- 1. Foundation (idempotent) — keep login working after the wipe. ---
    const [existing] = await sql`select id from orgs where name = 'Sunday AI Work'`;
    const orgId: string = existing?.id
      ?? (await sql`insert into orgs (name) values ('Sunday AI Work') returning id`)[0].id;

    for (const [actionClass, tier] of Object.entries(ACTION_CLASSES)) {
      await sql`
        insert into autonomy_policy (org_id, action_class, tier)
        values (${orgId}, ${actionClass}, ${tier})
        on conflict (org_id, action_class) do nothing`;
    }
    const passwordHash = bcrypt.hashSync('change-me-locally', 10);
    await sql`
      insert into users (org_id, email, full_name, role, password_hash)
      values (${orgId}, 'rick@sundayaiwork.com', 'Rick', 'admin', ${passwordHash})
      on conflict (email) do nothing`;

    // --- 2. Wipe domain data (cascade cleans anything referencing it). ---
    await sql`
      truncate table
        scores, placements, applications, candidate_documents, consents,
        messages, conversations, embeddings, decisions, agent_runs,
        timesheets, prospects, client_contacts,
        candidates, job_orders, clients
      restart identity cascade`;

    // --- 3. Clients (10). ---
    const clientIds: string[] = [];
    for (const name of CLIENT_NAMES) {
      const [c] = await sql`
        insert into clients (org_id, name, status) values (${orgId}, ${name}, 'active') returning id`;
      clientIds.push(c.id);
    }

    // --- 4. Job orders (10), one per client. ---
    const jobIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const title = JOB_TITLES[i];
      const [j] = await sql`
        insert into job_orders (org_id, client_id, title, description, must_haves, nice_to_haves, kind, status)
        values (
          ${orgId}, ${clientIds[i]}, ${title}, ${`We are hiring a ${title}.`},
          ${JSON.stringify(sample(SKILLS, rand(3, 5)))},
          ${JSON.stringify(sample(SKILLS, rand(2, 4)))},
          ${pick(KINDS)}, 'open'
        ) returning id`;
      jobIds.push(j.id);
    }

    // --- 5. Candidates (500), bulk-inserted. ---
    const candidateRows = Array.from({ length: 500 }, (_, i) => {
      const first = pick(FIRST);
      const last = pick(LAST);
      return {
        org_id: orgId,
        full_name: `${first} ${last}`,
        email: `${first}.${last}${i}@example.com`.toLowerCase(),
        phone: phone(),
        current_title: pick(TITLES),
        location: pick(CITIES),
        source: pick(SOURCES),
      };
    });
    const candidates = await sql`
      insert into candidates ${sql(candidateRows,
        'org_id', 'full_name', 'email', 'phone', 'current_title', 'location', 'source')}
      returning id`;
    const candidateIds = candidates.map((c) => c.id as string);

    // --- 6. Applications + fit scores. Each job gets 20–45 distinct candidates. ---
    const appRows: Array<Record<string, unknown>> = [];
    const scoreRows: Array<Record<string, unknown>> = [];
    for (const jobId of jobIds) {
      for (const candId of sample(candidateIds, rand(20, 45))) {
        appRows.push({ org_id: orgId, job_order_id: jobId, candidate_id: candId, stage: weightedStage() });
        const fit = pick(FIT_RATINGS);
        scoreRows.push({
          org_id: orgId, job_order_id: jobId, candidate_id: candId,
          prompt_version: pick(PROMPT_VERSIONS), model: pick(MODELS),
          fit_rating: fit, weighted_score: scoreFor(fit),
        });
      }
    }
    await sql`
      insert into applications ${sql(appRows, 'org_id', 'job_order_id', 'candidate_id', 'stage')}`;
    await sql`
      insert into scores ${sql(scoreRows,
        'org_id', 'job_order_id', 'candidate_id', 'prompt_version', 'model', 'fit_rating', 'weighted_score')}`;

    console.log(
      `Reseeded org ${orgId}: ${clientIds.length} clients, ${jobIds.length} jobs, ` +
      `${candidateIds.length} candidates, ${appRows.length} applications, ${scoreRows.length} scores`,
    );
  } finally {
    await sql.end();
  }
}

reseed();
