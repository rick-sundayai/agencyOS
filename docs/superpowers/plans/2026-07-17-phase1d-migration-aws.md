# Phase 1d — JobDiva Migration + AWS Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Scope decision (2026-07-17):** Only **Part A — the migration (Tasks 1–6)** is approved to start now. **Part B — the AWS infrastructure (Tasks 7–11: mail adapter, Amplify/GitHub, Terraform VPC/RDS, n8n on ECS Fargate, cutover)** is on hold pending review by an Architect to confirm the proposed AWS shape (Terraform, single-AZ RDS, ECS Fargate, Amplify) is the scalable model to commit to before any infrastructure is provisioned. Do not begin Task 7 onward without that sign-off.

Copied from the hub plan at `/Users/richardlove/Desktop/Projects/Claude/Agentic_Recruiting/01-architecture/phase1d-migration-aws-plan_2026-07-09.md` (source dated 2026-07-09).

**Goal:** Move the book of business out of JobDiva (one-way: candidates, resumes, jobs in — then JobDiva goes read-only) and deploy the whole system to AWS: Amplify cockpit, RDS Postgres + pgvector, n8n on ECS Fargate, S3, SES, Secrets Manager.

**Architecture:** Part A (Tasks 1–6) builds the migration as checkpointed, idempotent scripts inside the AgencyOS repo — a rate-limit-respecting JobDiva client, pure mapping functions ported from the validated n8n ingest workflows, an import runner keyed on `jobdiva_id` (ADR-0011), an embedding backfill, and a reconciliation report. All scripts are environment-agnostic (`DATABASE_URL`), so they validate locally first and then run against RDS. Part B (Tasks 7–11) is Terraform: one VPC with public subnets and tight security groups (boring and cheap; hardening path noted), one RDS instance hosting the `agency` and `n8n` databases, n8n behind an ALB, the cockpit on Amplify (WEB_COMPUTE), S3 for documents, SES behind a mail-adapter endpoint so the n8n Communication executor is transport-agnostic.

**Tech Stack:** TypeScript migration scripts (tsx, Vitest), JobDiva BI API v2, Terraform ~>1.7 + AWS provider ~>5, Amplify Hosting, RDS Postgres 17 + pgvector, ECS Fargate, ALB, S3, SESv2 (`@aws-sdk/client-sesv2`), Secrets Manager.

**Spec:** `/Users/richardlove/Desktop/Projects/Claude/Agentic_Recruiting/01-architecture/agentic-agency-greenfield-design_2026-07-09.md`
**Builds on:** Plans 1a–1c (same repo), all green.
**Ported knowledge (verified against live exports 2026-07-09):**
- JobDiva endpoints + response shapes from `Agentic_Recruiting/03-workflows-n8n/Ingest Candidate Details.json`, `Ingest Job Order.json`, `Agentic_Recruiter_Main.json`: BI responses are `{ data: [ { UPPERCASE_FIELDS } ] }`; candidates use `ID/FIRSTNAME/LASTNAME/EMAIL/CELLPHONE/PHONE1/PHONE2/CITY/STATE/COUNTRY`; resumes `PLAINTEXT`; jobs `ID/JOBTITLE/COMPANYNAME/JOBDESCRIPTION(HTML)/SKILLS/REMARKS/PAYRATEMAX/STARTDATE/ENDDATE`.
- `RecruiterPro/docs/adr/0011` (jobdiva_id as cross-table join key) and `0015` (watermark idempotency, upsert on `jobdiva_id`).
- Rate limit (project memory): **per-minute, undocumented, self-healing — protect with concurrency (sequential requests + backoff), not hourly caps.**

## Global Constraints

- Repo: `/Users/richardlove/Desktop/Projects/AgencyOS`. Preconditions: Plans 1a–1c complete; local stack green (`npm test`, golden scripts pass).
- **One-way migration:** AgencyOS is the ATS of record after cutover; nothing ever writes back to JobDiva. Idempotent re-runs: every imported row carries `jobdiva_id`; upserts key on `(org_id, jobdiva_id)`; resume docs skip when the text hash is unchanged (ADR-0015 watermark pattern).
- **JobDiva client is sequential** (concurrency 1) with exponential backoff + jitter on 429/5xx, re-auth on 401. Never parallelize JobDiva calls.
- JobDiva creds via env: `JOBDIVA_CLIENT_ID`, `JOBDIVA_USERNAME`, `JOBDIVA_PASSWORD` (in `.env`, gitignored; in Secrets Manager for prod). Live-API touchpoints are explicit, capped steps — fixture capture and the real import runs — never unit tests.
- **Verify-at-build flags for JobDiva** (the client isolates each in one constant): the authenticate path (`/apiv2/v2/authenticate` — confirm against the live n8n workflow `SundayAI — Auth — JobDiva`, which returns the full `Authorization` header value), the candidate-enumeration endpoint name (`NewUpdatedCandidateRecords` assumed symmetric with the confirmed `NewUpdatedJobRecords`), and the `fromDate`/`toDate` format (fixture-capture step confirms; start with `yyyy-MM-dd`).
- IaC: **Terraform** (spec §6 leaves SST/Terraform to the implementer; Terraform chosen — declarative, no framework coupling to Next.js). State stays local (`infra/terraform.tfstate`, gitignored) — single operator; move to S3 backend if a second operator ever appears.
- AWS region `us-east-1`. Cost posture: single-AZ RDS `db.t4g.small`, one Fargate task (0.5 vCPU/1GB), one ALB, no NAT (public subnets + strict security groups) ≈ $60–90/mo. Hardening path (private subnets + NAT, TLS on a real domain, Amplify env vars → SSM) is documented, deliberately deferred.
- Security groups: Postgres 5432 open only to `var.admin_cidr` (your IP) and the n8n task SG. Nothing world-open except ALB :80 and Amplify.
- SES starts in sandbox — sends only to verified addresses until production access is granted (runbook step included). Money/credential rules unchanged: prod `AGENT_API_KEY`/`AUTH_SECRET`/DB password are Terraform-generated randoms in Secrets Manager, never the dev placeholders.
- Zod v4, `getEnv()`/`getOptionalEnv()`, org_id scoping, relative imports, commit per task — all carried over.

## File Structure

```
AgencyOS/ (additions; M = modify)
├── .env / .env.example                     M  + JOBDIVA_*, MAIL_PROVIDER, MAILPIT_URL
├── src/
│   ├── lib/env.ts                          M  + getOptionalEnv(key, fallback)
│   ├── db/schema/ats.ts / crm.ts           M  + jobdiva_id columns
│   ├── db/schema/migration.ts                 migration_checkpoints
│   ├── services/mail.ts (+ .test.ts)          provider-switch send (mailpit | ses)
│   └── app/api/agent/mail/send/route.ts       transport endpoint for the executor
├── n8n/workflows/src/communication.workflow.mjs  M  auth headers on the mail call
├── n8n/apply-remote.sh                        push workflows to prod n8n via REST API
├── scripts/migration/
│   ├── jobdiva-client.ts (+ .test.ts)         auth, sequential GET + backoff, BI rows
│   ├── map.ts (+ .test.ts)                    BI rows → AgencyOS shapes (ported logic)
│   ├── chunk.ts (+ .test.ts)                  chunkText + sha256 (TS twin of helpers.js)
│   ├── capture-fixtures.ts                    one live pull → fixtures/ (gitignored)
│   ├── run-import.ts (+ import.test.ts)       checkpointed idempotent import
│   ├── backfill-embeddings.ts (+ .test.ts)    embed docs missing vectors
│   └── report.ts                              reconciliation markdown
├── docs/MIGRATION.md                          runbook: capture → dry-run → import → cutover
├── amplify.yml
└── infra/
    ├── providers.tf · variables.tf · vpc.tf · secrets.tf · rds.tf
    ├── ecs.tf · alb.tf · s3.tf · ses.tf · amplify.tf · outputs.tf
    └── .gitignore                             *.tfstate*, .terraform/
```

---

### Task 1: External-id schema — jobdiva_id, checkpoints

**Files:**
- Modify: `src/db/schema/ats.ts` (candidates, job_orders), `src/db/schema/crm.ts` (clients), `src/db/schema/index.ts`
- Create: `src/db/schema/migration.ts`, custom migration for partial unique indexes
- Test: `src/db/schema.test.ts` (append)

**Interfaces:**
- Consumes: 1a schema files.
- Produces: nullable `jobdiva_id: text` on `candidates`, `job_orders`, `clients`, each with a partial unique index on `(org_id, jobdiva_id) WHERE jobdiva_id IS NOT NULL`; table `migration_checkpoints` (`org_id`, `source` text, `watermark` timestamptz, `updated_at`; unique `(org_id, source)`). Import runner (Task 4) reads/writes checkpoints and upserts on `jobdiva_id` (ADR-0011).

- [ ] **Step 1: Append failing schema tests**

Append to `src/db/schema.test.ts`:

```ts
describe('migration schema (1d)', () => {
  it.each([['candidates'], ['job_orders'], ['clients']])('%s has jobdiva_id with a partial unique index', async (table) => {
    expect(await tableColumns(table)).toEqual(expect.arrayContaining(['jobdiva_id']));
    const idx = await sql`
      select 1 from pg_indexes where tablename = ${table}
      and indexdef ilike '%unique%' and indexdef ilike '%jobdiva_id%' and indexdef ilike '%where%'`;
    expect(idx.length).toBe(1);
  });

  it('migration_checkpoints exists with watermark', async () => {
    expect(await tableColumns('migration_checkpoints')).toEqual(
      expect.arrayContaining(['id', 'org_id', 'source', 'watermark', 'updated_at']),
    );
  });
});
```

Run: `npm test -- src/db/schema.test.ts` → new tests FAIL.

- [ ] **Step 2: Schema changes**

Add to the `candidates` and `job_orders` table definitions in `src/db/schema/ats.ts`, and to `clients` in `src/db/schema/crm.ts`:

```ts
  jobdiva_id: text('jobdiva_id'),
```

Create `src/db/schema/migration.ts`:

```ts
import { pgTable, uuid, text, timestamptz, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs } from './core';

export const migration_checkpoints = pgTable('migration_checkpoints', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  source: text('source').notNull(), // 'jobdiva-jobs' | 'jobdiva-candidates'
  watermark: timestamptz('watermark').notNull(),
  updated_at: timestamptz('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.org_id, t.source)]);
```

(Use `timestamp('...', { withTimezone: true })` if the installed drizzle-orm has no `timestamptz` helper — same rule as 1a.) Add `export * from './migration';` to `src/db/schema/index.ts`.

- [ ] **Step 3: Migrations — generated + custom partial indexes**

```bash
npm run db:generate -- --name jobdiva-ids
npm run db:custom -- --name jobdiva-unique
```

Edit the generated custom file to:

```sql
CREATE UNIQUE INDEX candidates_org_jobdiva_uq ON candidates (org_id, jobdiva_id) WHERE jobdiva_id IS NOT NULL;
CREATE UNIQUE INDEX job_orders_org_jobdiva_uq ON job_orders (org_id, jobdiva_id) WHERE jobdiva_id IS NOT NULL;
CREATE UNIQUE INDEX clients_org_jobdiva_uq ON clients (org_id, jobdiva_id) WHERE jobdiva_id IS NOT NULL;
```

(If the custom file sorts before the column migration, apply the 1a Task-7 fix: renumber the file and `drizzle/meta/_journal.json`.)

```bash
npm run db:migrate
npm test -- src/db/schema.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: jobdiva_id columns + partial unique indexes, migration checkpoints"
```

---

### Task 2: JobDiva API client — sequential, backoff, re-auth

**Files:**
- Create: `scripts/migration/jobdiva-client.ts`, `scripts/migration/capture-fixtures.ts`
- Modify: `.env` / `.env.example` (`JOBDIVA_CLIENT_ID`, `JOBDIVA_USERNAME`, `JOBDIVA_PASSWORD`), `.gitignore` (`scripts/migration/fixtures/`), `vitest.config.ts` (include `scripts/**/*.test.ts`)
- Test: `scripts/migration/jobdiva-client.test.ts`

**Interfaces:**
- Consumes: JobDiva BI API (endpoints verified from live exports; see header).
- Produces: `class JobDivaClient` — `authenticate(): Promise<string>`; `get(path, params): Promise<unknown>` (sequential, 6 attempts, exp backoff 2s→60s + jitter on 429/5xx, one re-auth on 401); `static rows(resp): BiRow[]` (`BiRow = Record<string, unknown>`); typed wrappers `newUpdatedJobRecords(fromDate, toDate)`, `newUpdatedCandidateRecords(fromDate, toDate)`, `jobDetail(jobId)`, `candidateDetail(candidateId)`, `candidateResumes(candidateId)`, `resumeDetail(resumeId)`. Tasks 4–5 consume; `capture-fixtures.ts` proves it live.

- [ ] **Step 1: Env + vitest include**

Append to `.env` (real values) and `.env.example` (placeholders):

```
JOBDIVA_CLIENT_ID=your-jobdiva-client-id
JOBDIVA_USERNAME=your-jobdiva-username
JOBDIVA_PASSWORD=your-jobdiva-password
```

In `vitest.config.ts`, set include to:

```ts
    include: ['src/**/*.test.{ts,tsx}', 'n8n/**/*.test.ts', 'scripts/**/*.test.ts'],
```

Append `scripts/migration/fixtures/` to `.gitignore`.

- [ ] **Step 2: Failing client tests (stubbed fetch — no live calls)**

Create `scripts/migration/jobdiva-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobDivaClient } from './jobdiva-client';

const creds = { clientid: 'c', username: 'u', password: 'p' };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const ok = (body: unknown, init: { status?: number; text?: boolean } = {}) => ({
  ok: (init.status ?? 200) < 400,
  status: init.status ?? 200,
  text: async () => String(body),
  json: async () => body,
});

describe('JobDivaClient', () => {
  it('authenticates once and reuses the bearer token', async () => {
    fetchMock
      .mockResolvedValueOnce(ok('raw-token'))
      .mockResolvedValueOnce(ok({ data: [{ ID: 1 }] }));
    const c = new JobDivaClient(creds);
    const resp = await c.get('/apiv2/bi/JobDetail', { jobId: '1' });
    expect(JobDivaClient.rows(resp)).toEqual([{ ID: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toContain('/apiv2/v2/authenticate?');
    const authHeader = fetchMock.mock.calls[1][1].headers.Authorization;
    expect(authHeader).toBe('Bearer raw-token');
  });

  it('backs off and retries on 429, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(ok('t'))
      .mockResolvedValueOnce(ok('slow down', { status: 429 }))
      .mockResolvedValueOnce(ok({ data: [{ ID: 2 }] }));
    const c = new JobDivaClient(creds);
    const p = c.get('/apiv2/bi/JobDetail', { jobId: '2' });
    await vi.advanceTimersByTimeAsync(5000); // covers first 2s(+jitter) backoff
    const resp = await p;
    expect(JobDivaClient.rows(resp)).toEqual([{ ID: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('re-authenticates once on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(ok('stale'))
      .mockResolvedValueOnce(ok('denied', { status: 401 }))
      .mockResolvedValueOnce(ok('fresh'))
      .mockResolvedValueOnce(ok({ data: [] }));
    const c = new JobDivaClient(creds);
    await c.get('/apiv2/bi/CandidateDetail', { candidateId: '9' });
    const lastAuth = fetchMock.mock.calls[3][1].headers.Authorization;
    expect(lastAuth).toBe('Bearer fresh');
  });

  it('rows() handles bare arrays and {data} envelopes', () => {
    expect(JobDivaClient.rows([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(JobDivaClient.rows({ data: [{ b: 2 }] })).toEqual([{ b: 2 }]);
    expect(JobDivaClient.rows({ nope: true })).toEqual([]);
  });
});
```

Run: `npm test -- scripts/migration/jobdiva-client.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the client**

Create `scripts/migration/jobdiva-client.ts`:

```ts
// JobDiva BI API client. The per-minute rate limit is undocumented and self-healing:
// protect with CONCURRENCY (all calls sequential) and backoff — never hourly caps,
// never parallel fan-out. (Project memory: jobdiva-api-rate-limit.)
const BASE = 'https://api.jobdiva.com';

export type BiRow = Record<string, unknown>;
export type JobDivaCreds = { clientid: string; username: string; password: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JobDivaClient {
  private token: string | null = null;

  constructor(private creds: JobDivaCreds = {
    clientid: process.env.JOBDIVA_CLIENT_ID ?? '',
    username: process.env.JOBDIVA_USERNAME ?? '',
    password: process.env.JOBDIVA_PASSWORD ?? '',
  }) {}

  // VERIFY at first live run: path confirmed against the live n8n "SundayAI — Auth — JobDiva"
  // workflow, which returns the full Authorization header value.
  async authenticate(): Promise<string> {
    const qs = new URLSearchParams(this.creds as unknown as Record<string, string>);
    const res = await fetch(`${BASE}/apiv2/v2/authenticate?${qs}`);
    if (!res.ok) throw new Error(`JobDiva auth failed: ${res.status}`);
    const body = (await res.text()).trim().replace(/^"|"$/g, '');
    this.token = body.startsWith('Bearer ') ? body : `Bearer ${body}`;
    return this.token;
  }

  async get(path: string, params: Record<string, string>): Promise<unknown> {
    if (!this.token) await this.authenticate();
    const url = `${BASE}${path}?${new URLSearchParams(params)}`;
    let delay = 2000;
    let reauthed = false;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: this.token! },
      });
      if (res.status === 401 && !reauthed) {
        reauthed = true;
        await this.authenticate();
        continue;
      }
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) {
        await sleep(delay + Math.random() * 1000);
        delay = Math.min(delay * 2, 60_000);
        continue;
      }
      throw new Error(`JobDiva ${path} failed: ${res.status}`);
    }
    throw new Error(`JobDiva ${path}: retries exhausted`);
  }

  static rows(resp: unknown): BiRow[] {
    if (Array.isArray(resp)) return resp as BiRow[];
    const d = (resp as { data?: unknown } | null)?.data;
    return Array.isArray(d) ? (d as BiRow[]) : [];
  }

  // Dates: start with yyyy-MM-dd; capture-fixtures confirms the accepted format.
  newUpdatedJobRecords(fromDate: string, toDate: string) {
    return this.get('/apiv2/bi/NewUpdatedJobRecords', { fromDate, toDate });
  }
  // VERIFY at first live run: assumed symmetric with NewUpdatedJobRecords.
  newUpdatedCandidateRecords(fromDate: string, toDate: string) {
    return this.get('/apiv2/bi/NewUpdatedCandidateRecords', { fromDate, toDate });
  }
  jobDetail(jobId: string) { return this.get('/apiv2/bi/JobDetail', { jobId }); }
  candidateDetail(candidateId: string) { return this.get('/apiv2/bi/CandidateDetail', { candidateId }); }
  candidateResumes(candidateId: string) { return this.get('/apiv2/bi/CandidateResumesDetail', { candidateId }); }
  resumeDetail(resumeId: string) { return this.get('/apiv2/bi/ResumeDetail', { resumeId }); }
}
```

Run: `npm test -- scripts/migration/jobdiva-client.test.ts` → PASS (4 tests).

- [ ] **Step 4: Fixture capture (the one live verification)**

Create `scripts/migration/capture-fixtures.ts`:

```ts
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
```

Run: `npx tsx scripts/migration/capture-fixtures.ts`
Expected: six JSON files in `scripts/migration/fixtures/`. **Inspect them now** — confirm the
candidate-enumeration endpoint responded (else find the correct name in the JobDiva API docs and fix the
one constant), the date format was accepted, and field names match the mapping in Task 3 (`FIRSTNAME`,
`CELLPHONE`, `PLAINTEXT`, `JOBTITLE`, …). Adjust Task 3's field list to reality before proceeding.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: JobDiva client — sequential rate-limited BI access + fixture capture"
```

---

### Task 3: Mapping layer — BI rows → AgencyOS shapes

**Files:**
- Create: `scripts/migration/map.ts`, `scripts/migration/chunk.ts`
- Test: `scripts/migration/map.test.ts`, `scripts/migration/chunk.test.ts`

**Interfaces:**
- Consumes: `BiRow` from Task 2; fixture files for shape truth.
- Produces:
  - `cleanHtml(html): string` — ported verbatim from the validated `Parse Job Order Details` node.
  - `mapCandidate(row: BiRow)` → `{ jobdiva_id, full_name, email, phone, current_title, location, source: 'jobdiva' }` (email null unless it looks like an email — Zod `z.email()` downstream must not reject a whole record).
  - `mapJob(row: BiRow)` → `{ jobdiva_id, title, company_name, description, must_haves: string[], kind: 'contract' }` (JobDiva job type isn't reliably mapped; default `'contract'`, correct per-order in the cockpit).
  - `pickLatestResume(rows: BiRow[]): string | null` — resume id of the newest resume.
  - `chunkText(text, size = 1500, overlap = 200): string[]` and `sha256(s): string` — TS twins of `n8n/workflows/src/helpers.js` (Task 5 reuses; parity matters so backfill chunks match Data-Steward chunks).

- [ ] **Step 1: Failing tests**

Create `scripts/migration/chunk.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chunkText, sha256 } from './chunk';

describe('chunkText', () => {
  it('chunks with overlap and covers the whole text', () => {
    const text = 'x'.repeat(4000);
    const chunks = chunkText(text);
    expect(chunks[0]).toHaveLength(1500);
    expect(chunks.length).toBe(3); // 0-1500, 1300-2800, 2600-4000
    expect(chunks[1].slice(0, 200)).toBe(chunks[0].slice(1300));
  });
  it('short text is a single chunk', () => {
    expect(chunkText('short')).toEqual(['short']);
  });
});

describe('sha256', () => {
  it('is deterministic hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
```

Create `scripts/migration/map.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cleanHtml, mapCandidate, mapJob, pickLatestResume } from './map';

describe('cleanHtml', () => {
  it('strips tags and entities, collapses whitespace', () => {
    expect(cleanHtml('<p>Senior&nbsp;<b>Dev</b></p>\n\n needed')).toBe('Senior Dev needed');
  });
});

describe('mapCandidate', () => {
  const row = {
    ID: 12345, FIRSTNAME: ' Ada ', LASTNAME: 'Lovelace', EMAIL: 'ada@example.com',
    CELLPHONE: '555-0100', PHONE1: '555-0199', CITY: 'Boston', STATE: 'MA', COUNTRY: 'United States',
  };
  it('maps names, contact, and location', () => {
    expect(mapCandidate(row)).toEqual({
      jobdiva_id: '12345', full_name: 'Ada Lovelace', email: 'ada@example.com',
      phone: '555-0100', current_title: null, location: 'Boston, MA, United States', source: 'jobdiva',
    });
  });
  it('prefers CELLPHONE, falls back PHONE2 then PHONE1', () => {
    expect(mapCandidate({ ...row, CELLPHONE: null, PHONE2: '555-0111' }).phone).toBe('555-0111');
    expect(mapCandidate({ ...row, CELLPHONE: null }).phone).toBe('555-0199');
  });
  it('nulls a malformed email instead of failing the record', () => {
    expect(mapCandidate({ ...row, EMAIL: 'not-an-email' }).email).toBeNull();
  });
});

describe('mapJob', () => {
  it('cleans HTML and splits skills', () => {
    const j = mapJob({
      ID: 77, JOBTITLE: 'React Dev', COMPANYNAME: 'Acme',
      JOBDESCRIPTION: '<div>Build <b>apps</b></div>', SKILLS: 'React; TypeScript, AWS',
    });
    expect(j).toEqual({
      jobdiva_id: '77', title: 'React Dev', company_name: 'Acme',
      description: 'Build apps', must_haves: ['React', 'TypeScript', 'AWS'], kind: 'contract',
    });
  });
});

describe('pickLatestResume', () => {
  it('returns the id of the newest resume across date-field spellings', () => {
    expect(pickLatestResume([
      { RESUMEID: 1, DATERECEIVED: '2024-01-01' },
      { RESUMEID: 2, DATERECEIVED: '2026-05-01' },
    ])).toBe('2');
    expect(pickLatestResume([])).toBeNull();
  });
});
```

Run: `npm test -- scripts/migration` → new tests FAIL (modules missing).

- [ ] **Step 2: Implement**

Create `scripts/migration/chunk.ts`:

```ts
// TS twins of n8n/workflows/src/helpers.js chunkText/sha256 — keep in sync so
// backfilled chunks match what the Data Steward workflow produces at runtime.
import { createHash } from 'node:crypto';

export const chunkText = (text: string, size = 1500, overlap = 200): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
};

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
```

Create `scripts/migration/map.ts`:

```ts
import type { BiRow } from './jobdiva-client';

// Ported verbatim from the validated "Parse Job Order Details" n8n node.
export const cleanHtml = (html: string | null | undefined): string => {
  if (!html) return '';
  return html
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const s = (row: BiRow, key: string): string | null => {
  const v = row[key];
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

export function mapCandidate(row: BiRow) {
  const rawEmail = s(row, 'EMAIL');
  return {
    jobdiva_id: String(row.ID ?? row.CANDIDATEID ?? ''),
    full_name: [s(row, 'FIRSTNAME'), s(row, 'LASTNAME')].filter(Boolean).join(' ') || 'Unknown',
    email: rawEmail && /.+@.+\..+/.test(rawEmail) ? rawEmail : null,
    phone: s(row, 'CELLPHONE') ?? s(row, 'PHONE2') ?? s(row, 'PHONE1'),
    current_title: s(row, 'TITLE'),
    location: [s(row, 'CITY'), s(row, 'STATE'), s(row, 'COUNTRY')].filter(Boolean).join(', ') || null,
    source: 'jobdiva' as const,
  };
}

export function mapJob(row: BiRow) {
  return {
    jobdiva_id: String(row.ID ?? ''),
    title: s(row, 'JOBTITLE') ?? 'Untitled',
    company_name: s(row, 'COMPANYNAME'),
    description: cleanHtml(s(row, 'JOBDESCRIPTION')),
    must_haves: (s(row, 'SKILLS') ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean),
    // JobDiva's position-type field isn't reliably mapped (see ADR-0015's CHECK-column
    // precedent) — default to the agency's dominant book; correct per-order in the cockpit.
    kind: 'contract' as const,
  };
}

export function pickLatestResume(rows: BiRow[]): string | null {
  if (rows.length === 0) return null;
  const dateOf = (r: BiRow) =>
    new Date(String(r.DATERECEIVED ?? r.DATECREATED ?? r.MODIFIEDDATE ?? 0)).getTime() || 0;
  const latest = [...rows].sort((a, b) => dateOf(b) - dateOf(a))[0];
  const id = latest.RESUMEID ?? latest.ID;
  return id == null ? null : String(id);
}
```

Run: `npm test -- scripts/migration` → PASS. **Cross-check field names against the Task-2 fixtures**
(`candidate-detail.json`, `job-detail.json`, `candidate-resumes.json`) and adjust `s(row, '...')` keys if
reality differs.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: JobDiva → AgencyOS mapping (ported clean/map logic) + chunk twins"
```

---

### Task 4: Import runner — checkpointed, idempotent

**Files:**
- Create: `scripts/migration/run-import.ts`
- Test: `scripts/migration/import.test.ts`

**Interfaces:**
- Consumes: `JobDivaClient` (Task 2), `mapCandidate`/`mapJob`/`pickLatestResume` (Task 3), `sha256` (Task 3), `ingestCandidate` (Plan 1c Task 4), `db` + `candidates`, `job_orders`, `clients`, `candidate_documents`, `migration_checkpoints`.
- Produces: `runImport(opts: { orgId: string; since: string; until: string; dryRun: boolean; limit?: number; client?: JobDivaClient }): Promise<{ jobs: number; candidates: number; resumes: number; skipped: number }>` plus a CLI (`npx tsx scripts/migration/run-import.ts --since 2015-01-01 [--until 2026-07-31] [--dry-run] [--limit 25]`). Idempotency: jobs/clients upsert on `(org_id, jobdiva_id)`; candidates matched by `jobdiva_id` first, then `ingestCandidate` dedupe; resume text skipped when `sha256` matches the latest stored document (ADR-0015 watermark). Checkpoints advance per completed monthly window.

- [ ] **Step 1: Failing integration test (mocked client, real local DB)**

Create `scripts/migration/import.test.ts`:

```ts
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

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  await clearCheckpoints();
});
afterAll(clearCheckpoints);

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
```

Run: `npm test -- scripts/migration/import.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the runner**

Create `scripts/migration/run-import.ts`:

```ts
import 'dotenv/config';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  candidates, candidate_documents, clients, job_orders, migration_checkpoints,
} from '../../src/db/schema';
import { ingestCandidate } from '../../src/services/ingest';
import { JobDivaClient, type BiRow } from './jobdiva-client';
import { mapCandidate, mapJob, pickLatestResume } from './map';
import { sha256 } from './chunk';

export type ImportOpts = {
  orgId: string; since: string; until: string;
  dryRun: boolean; limit?: number; client?: JobDivaClient;
};
export type ImportResult = { jobs: number; candidates: number; resumes: number; skipped: number };

function* monthWindows(since: string, until: string): Generator<[string, string]> {
  let start = new Date(since + 'T00:00:00Z');
  const end = new Date(until + 'T00:00:00Z');
  while (start < end) {
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const stop = next < end ? next : end;
    yield [start.toISOString().slice(0, 10), stop.toISOString().slice(0, 10)];
    start = stop;
  }
}

async function checkpoint(orgId: string, source: string): Promise<string | null> {
  const [row] = await db.select().from(migration_checkpoints).where(and(
    eq(migration_checkpoints.org_id, orgId), eq(migration_checkpoints.source, source)));
  return row ? row.watermark.toISOString().slice(0, 10) : null;
}

async function advance(orgId: string, source: string, watermark: string) {
  await db.insert(migration_checkpoints)
    .values({ org_id: orgId, source, watermark: new Date(watermark + 'T00:00:00Z') })
    .onConflictDoUpdate({
      target: [migration_checkpoints.org_id, migration_checkpoints.source],
      set: { watermark: new Date(watermark + 'T00:00:00Z'), updated_at: new Date() },
    });
}

async function importJob(orgId: string, row: BiRow, dryRun: boolean): Promise<void> {
  const j = mapJob(row);
  if (!j.jobdiva_id) return;
  if (dryRun) { console.log('[dry] job', j.jobdiva_id, j.title); return; }

  let clientId: string | null = null;
  if (j.company_name) {
    const [existing] = await db.select().from(clients).where(and(
      eq(clients.org_id, orgId), eq(clients.name, j.company_name)));
    clientId = existing?.id
      ?? (await db.insert(clients).values({ org_id: orgId, name: j.company_name }).returning())[0].id;
  }

  const [current] = await db.select().from(job_orders).where(and(
    eq(job_orders.org_id, orgId), eq(job_orders.jobdiva_id, j.jobdiva_id)));
  if (current) {
    await db.update(job_orders).set({
      title: j.title, description: j.description, must_haves: j.must_haves, client_id: clientId,
    }).where(eq(job_orders.id, current.id));
  } else {
    await db.insert(job_orders).values({
      org_id: orgId, jobdiva_id: j.jobdiva_id, client_id: clientId,
      title: j.title, description: j.description, must_haves: j.must_haves,
      kind: j.kind, status: 'open',
    });
  }
}

async function importCandidate(
  orgId: string, row: BiRow, jd: JobDivaClient, dryRun: boolean,
): Promise<{ imported: boolean; resumeImported: boolean }> {
  const m = mapCandidate(row);
  if (!m.jobdiva_id) return { imported: false, resumeImported: false };
  if (dryRun) { console.log('[dry] candidate', m.jobdiva_id, m.full_name); return { imported: true, resumeImported: false }; }

  // Resume text (skippable by hash) — fetched before ingest so one ingest call does both.
  let resumeText: string | null = null;
  const resumeId = pickLatestResume(JobDivaClient.rows(await jd.candidateResumes(m.jobdiva_id)));
  if (resumeId) {
    const detail = JobDivaClient.rows(await jd.resumeDetail(resumeId))[0];
    resumeText = detail?.PLAINTEXT ? String(detail.PLAINTEXT) : null;
  }

  const [known] = await db.select().from(candidates).where(and(
    eq(candidates.org_id, orgId), eq(candidates.jobdiva_id, m.jobdiva_id)));

  let resumeImported = false;
  if (known && resumeText) {
    // Watermark check (ADR-0015 pattern): skip when the latest stored text hash matches.
    const [latestDoc] = await db.select().from(candidate_documents)
      .where(eq(candidate_documents.candidate_id, known.id))
      .orderBy(desc(candidate_documents.version)).limit(1);
    if (latestDoc?.parsed_text && sha256(latestDoc.parsed_text) === sha256(resumeText)) {
      resumeText = null; // unchanged — do not bump a version
    }
  }

  const { candidate_id, document_id } = await ingestCandidate({
    org_id: orgId, full_name: m.full_name, email: m.email, phone: m.phone,
    current_title: m.current_title, location: m.location, source: m.source,
    resume_text: resumeText,
  });
  resumeImported = document_id !== null;

  if (!known) {
    await db.update(candidates).set({ jobdiva_id: m.jobdiva_id }).where(eq(candidates.id, candidate_id));
  }
  return { imported: true, resumeImported };
}

export async function runImport(opts: ImportOpts): Promise<ImportResult> {
  const jd = opts.client ?? new JobDivaClient();
  const result: ImportResult = { jobs: 0, candidates: 0, resumes: 0, skipped: 0 };
  let budget = opts.limit ?? Infinity;

  for (const source of ['jobdiva-jobs', 'jobdiva-candidates'] as const) {
    const mark = opts.dryRun ? null : await checkpoint(opts.orgId, source);
    const since = mark && mark > opts.since ? mark : opts.since;
    for (const [from, to] of monthWindows(since, opts.until)) {
      const listResp = source === 'jobdiva-jobs'
        ? await jd.newUpdatedJobRecords(from, to)
        : await jd.newUpdatedCandidateRecords(from, to);
      const ids = [...new Set(JobDivaClient.rows(listResp).map((r) => String(r.ID ?? '')))].filter(Boolean);

      for (const id of ids) {
        if (budget-- <= 0) { console.log('limit reached'); return result; }
        try {
          if (source === 'jobdiva-jobs') {
            const detail = JobDivaClient.rows(await jd.jobDetail(id))[0];
            if (detail) { await importJob(opts.orgId, detail, opts.dryRun); result.jobs++; }
          } else {
            const detail = JobDivaClient.rows(await jd.candidateDetail(id))[0];
            if (detail) {
              const r = await importCandidate(opts.orgId, detail, jd, opts.dryRun);
              if (r.imported) result.candidates++;
              if (r.resumeImported) result.resumes++;
            }
          }
        } catch (err) {
          result.skipped++;
          console.error(`skip ${source} ${id}:`, err instanceof Error ? err.message : err);
        }
      }
      if (!opts.dryRun) await advance(opts.orgId, source, to);
      console.log(`${source} ${from}..${to}: done (${ids.length} ids)`);
    }
  }
  return result;
}

// CLI: npx tsx scripts/migration/run-import.ts --since 2015-01-01 [--until 2026-07-31] [--dry-run] [--limit 25]
if (process.argv[1]?.endsWith('run-import.ts')) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? null : process.argv[i + 1] ?? 'true';
  };
  (async () => {
    const postgres = (await import('postgres')).default;
    const { getEnv } = await import('../../src/lib/env');
    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id as string;
    await sql.end();
    const r = await runImport({
      orgId,
      since: arg('since') ?? '2015-01-01',
      until: arg('until') ?? new Date().toISOString().slice(0, 10),
      dryRun: process.argv.includes('--dry-run'),
      limit: arg('limit') ? Number(arg('limit')) : undefined,
    });
    console.log('import result:', r);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
```

Run: `npm test -- scripts/migration/import.test.ts` → PASS (4 tests).

- [ ] **Step 3: Capped live dry-run**

```bash
npx tsx scripts/migration/run-import.ts --since 2026-06-01 --dry-run --limit 10
```

Expected: `[dry] job …` / `[dry] candidate …` lines with real names from JobDiva; no DB writes; no rate-limit errors (sequential pacing holds).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: checkpointed idempotent JobDiva import runner"
```

---

### Task 5: Embedding backfill

**Files:**
- Create: `scripts/migration/backfill-embeddings.ts`
- Test: `scripts/migration/backfill-embeddings.test.ts`

**Interfaces:**
- Consumes: `chunkText`/`sha256` (Task 3), `upsertEmbeddings` (Plan 1c Task 4), `candidate_documents`/`embeddings` tables, Gemini REST (`GEMINI_API_KEY`).
- Produces: `backfillEmbeddings(opts: { orgId: string; limit?: number; embedFn?: (text: string) => Promise<number[]> }): Promise<{ embedded: number; skipped: number }>` — finds latest-version resume documents with no embedding rows, chunks, embeds (Gemini concurrency 2 — Gemini tolerates it; JobDiva is not involved here), upserts. Naturally resumable: embedded docs stop matching the query. CLI: `npx tsx scripts/migration/backfill-embeddings.ts [--limit 50]`.

- [ ] **Step 1: Failing test (injected embedFn — no live calls)**

Create `scripts/migration/backfill-embeddings.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../../src/lib/env';
import { ingestCandidate } from '../../src/services/ingest';
import { backfillEmbeddings } from './backfill-embeddings';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
let documentId: string;

const fakeEmbed = async () => { const v = new Array(3072).fill(0); v[0] = 1; return v; };

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  const r = await ingestCandidate({
    org_id: orgId, full_name: 'Backfill Target',
    email: `backfill-${Date.now()}@example.com`,
    resume_text: 'resume text '.repeat(200), // > 1 chunk
  });
  documentId = r.document_id!;
});

describe('backfillEmbeddings', () => {
  it('embeds documents lacking vectors, then skips them on re-run', async () => {
    const first = await backfillEmbeddings({ orgId, embedFn: fakeEmbed });
    expect(first.embedded).toBeGreaterThanOrEqual(1);
    const [{ n }] = await sql`select count(*)::int as n from embeddings where subject_id = ${documentId}`;
    expect(n).toBeGreaterThanOrEqual(2); // multiple chunks

    const again = await backfillEmbeddings({ orgId, embedFn: fakeEmbed });
    const stillMine = (await sql`select count(*)::int as n from embeddings where subject_id = ${documentId}`)[0].n;
    expect(stillMine).toBe(n); // unchanged
    expect(again.embedded).toBe(0);
  });
});
```

Run: `npm test -- scripts/migration/backfill-embeddings.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

Create `scripts/migration/backfill-embeddings.ts`:

```ts
import 'dotenv/config';
import { db } from '../../src/db/client';
import { sql as dsql } from 'drizzle-orm';
import { upsertEmbeddings } from '../../src/services/ingest';
import { chunkText, sha256 } from './chunk';

async function geminiEmbed(text: string): Promise<number[]> {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 3072,
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini embed failed: ${res.status}`);
  return (await res.json()).embedding.values as number[];
}

export async function backfillEmbeddings(opts: {
  orgId: string; limit?: number; embedFn?: (text: string) => Promise<number[]>;
}): Promise<{ embedded: number; skipped: number }> {
  const embed = opts.embedFn ?? geminiEmbed;
  // Latest-version resume docs with text and no embedding rows.
  const docs = (await db.execute(dsql`
    select cd.id, cd.parsed_text
    from candidate_documents cd
    where cd.org_id = ${opts.orgId}
      and cd.parsed_text is not null
      and cd.version = (select max(v.version) from candidate_documents v where v.candidate_id = cd.candidate_id)
      and not exists (select 1 from embeddings e where e.subject_id = cd.id and e.subject_type = 'candidate_document')
    limit ${opts.limit ?? 100000}`)) as unknown as Array<{ id: string; parsed_text: string }>;

  let embedded = 0; let skipped = 0;
  for (const doc of docs) {
    try {
      const chunks = chunkText(doc.parsed_text);
      const rows: Array<{ chunk_index: number; content: string; embedding: number[]; content_hash: string }> = [];
      // Concurrency 2 on Gemini (Gemini-side limit, generous; JobDiva is not involved here).
      for (let i = 0; i < chunks.length; i += 2) {
        const pair = chunks.slice(i, i + 2);
        const vecs = await Promise.all(pair.map((c) => embed(c)));
        pair.forEach((c, k) => rows.push({
          chunk_index: i + k, content: c, embedding: vecs[k], content_hash: sha256(c),
        }));
      }
      await upsertEmbeddings({
        org_id: opts.orgId, subject_type: 'candidate_document', subject_id: doc.id, chunks: rows,
      });
      embedded++;
      if (embedded % 25 === 0) console.log(`embedded ${embedded}/${docs.length} docs`);
    } catch (err) {
      skipped++;
      console.error(`skip doc ${doc.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { embedded, skipped };
}

if (process.argv[1]?.endsWith('backfill-embeddings.ts')) {
  (async () => {
    const postgres = (await import('postgres')).default;
    const { getEnv } = await import('../../src/lib/env');
    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id as string;
    await sql.end();
    const i = process.argv.indexOf('--limit');
    console.log(await backfillEmbeddings({ orgId, limit: i === -1 ? undefined : Number(process.argv[i + 1]) }));
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
```

Run: `npm test -- scripts/migration/backfill-embeddings.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: resumable embedding backfill for migrated resumes"
```

---

### Task 6: Reconciliation report + migration runbook

**Files:**
- Create: `scripts/migration/report.ts`, `docs/MIGRATION.md`

**Interfaces:**
- Consumes: all migrated tables.
- Produces: `npx tsx scripts/migration/report.ts` → writes `docs/migration-report_<YYYY-MM-DD>.md` with counts and gap lists; `docs/MIGRATION.md` is the ordered cutover runbook Tasks 11 executes.

- [ ] **Step 1: Report script**

Create `scripts/migration/report.ts`:

```ts
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
```

Verify locally (against whatever the import test left behind):

```bash
mkdir -p docs
npx tsx scripts/migration/report.ts
```

Expected: `docs/migration-report_<date>.md` exists with a populated table.

- [ ] **Step 2: Runbook**

Create `docs/MIGRATION.md`:

```markdown
# JobDiva → AgencyOS migration runbook (one-way)

Order of operations. Each step is safe to repeat — the import is idempotent
(jobdiva_id upserts + resume-hash watermark) and the backfill is resumable.

1. **Fixture capture** — `npx tsx scripts/migration/capture-fixtures.ts`
   Confirms endpoints, date format, field names. Inspect `scripts/migration/fixtures/`.
2. **Dry run** — `npx tsx scripts/migration/run-import.ts --since 2026-06-01 --dry-run --limit 10`
3. **Limited real run (local DB)** — same command without `--dry-run`; verify in the cockpit.
4. **Full run against production RDS** —
   `DATABASE_URL=<rds-agency-url> npx tsx scripts/migration/run-import.ts --since 2015-01-01`
   Sequential by design; a large book takes hours. Re-run on interruption — checkpoints resume.
   (Adjust `--since` to when the agency's JobDiva history starts.)
5. **Embedding backfill** — `DATABASE_URL=<rds> GEMINI_API_KEY=<key> npx tsx scripts/migration/backfill-embeddings.ts`
6. **Reconcile** — `DATABASE_URL=<rds> npx tsx scripts/migration/report.ts`; compare counts to JobDiva.
7. **Cutover** — when counts reconcile: stop creating/editing records in JobDiva; record
   "JobDiva read-only as of <date>" in `Agentic_Recruiting/Project_State.md`. JobDiva stays
   available read-only for reference; nothing syncs in either direction after this point.

Rate limit: JobDiva's per-minute limit is undocumented and self-healing. The client is
sequential with exponential backoff. If runs stall on repeated 429s, wait a few minutes;
do not add parallelism.
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: reconciliation report + migration runbook"
```

---

### Task 7: Mail adapter — provider-switched transport (Mailpit dev / SES prod)

**Files:**
- Create: `src/services/mail.ts`, `src/app/api/agent/mail/send/route.ts`
- Modify: `src/lib/env.ts` (`getOptionalEnv`), `n8n/workflows/src/communication.workflow.mjs` (auth headers on the mail call), `docker-compose.yml` (n8n `MAIL_API_URL`), `.env` / `.env.example` (`MAIL_PROVIDER`, `MAILPIT_URL`)
- Test: `src/services/mail.test.ts`

**Interfaces:**
- Consumes: `requireAgentKey`; Mailpit HTTP API; `@aws-sdk/client-sesv2`.
- Produces:
  - `getOptionalEnv(key: string, fallback: string): string` in `src/lib/env.ts`.
  - `sendMail(input: unknown): Promise<{ provider: 'mailpit' | 'ses'; id: string | null }>` — payload shape stays exactly what the Communication executor already posts: `{ From: { Email, Name? }, To: [{ Email }], Subject, Text }` (`MailPayloadSchema`). Provider from `MAIL_PROVIDER` (`mailpit` default, `ses` in prod).
  - HTTP: `POST /api/agent/mail/send` (agent-key authed) → 200 `{ provider, id }` / 400. n8n's `MAIL_API_URL` now points here in **both** environments — SES in prod is just env config.

- [ ] **Step 1: Failing tests**

```bash
npm install @aws-sdk/client-sesv2
```

Create `src/services/mail.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

const sesSend = vi.fn().mockResolvedValue({ MessageId: 'ses-123' });
vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn(() => ({ send: sesSend })),
  SendEmailCommand: vi.fn((input) => ({ input })),
}));

import { sendMail } from './mail';

const payload = {
  From: { Email: 'recruiting@sundayaiwork.dev', Name: 'Recruiting' },
  To: [{ Email: 'candidate@example.com' }],
  Subject: 'Hello', Text: 'Body',
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MAIL_PROVIDER;
});

describe('sendMail', () => {
  it('defaults to mailpit and posts the payload through', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ID: 'mp-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const r = await sendMail(payload);
    expect(r).toEqual({ provider: 'mailpit', id: 'mp-1' });
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/send');
  });

  it('uses SES when MAIL_PROVIDER=ses', async () => {
    process.env.MAIL_PROVIDER = 'ses';
    const r = await sendMail(payload);
    expect(r).toEqual({ provider: 'ses', id: 'ses-123' });
    const cmd = sesSend.mock.calls.at(-1)![0].input;
    expect(cmd.Destination.ToAddresses).toEqual(['candidate@example.com']);
    expect(cmd.Content.Simple.Subject.Data).toBe('Hello');
  });

  it('rejects an invalid payload', async () => {
    await expect(sendMail({ To: [] })).rejects.toThrow();
  });
});
```

Run: `npm test -- src/services/mail.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement**

Add to `src/lib/env.ts`:

```ts
/** Optional env with a fallback — for knobs that have a sane dev default. */
export function getOptionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}
```

Create `src/services/mail.ts`:

```ts
import { z } from 'zod';
import { getOptionalEnv } from '../lib/env';

export const MailPayloadSchema = z.strictObject({
  From: z.strictObject({ Email: z.email(), Name: z.string().optional() }),
  To: z.array(z.strictObject({ Email: z.email() })).min(1),
  Subject: z.string().min(1),
  Text: z.string().min(1),
});

export async function sendMail(input: unknown): Promise<{ provider: 'mailpit' | 'ses'; id: string | null }> {
  const p = MailPayloadSchema.parse(input);
  const provider = getOptionalEnv('MAIL_PROVIDER', 'mailpit');

  if (provider === 'ses') {
    const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
    const client = new SESv2Client({ region: getOptionalEnv('AWS_REGION', 'us-east-1') });
    const res = await client.send(new SendEmailCommand({
      FromEmailAddress: p.From.Name ? `${p.From.Name} <${p.From.Email}>` : p.From.Email,
      Destination: { ToAddresses: p.To.map((t) => t.Email) },
      Content: { Simple: { Subject: { Data: p.Subject }, Body: { Text: { Data: p.Text } } } },
    }));
    return { provider: 'ses', id: res.MessageId ?? null };
  }

  const base = getOptionalEnv('MAILPIT_URL', 'http://localhost:8025');
  const res = await fetch(`${base}/api/v1/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error(`mailpit send failed: ${res.status}`);
  const j = (await res.json()) as { ID?: string };
  return { provider: 'mailpit', id: j.ID ?? null };
}
```

Create `src/app/api/agent/mail/send/route.ts`:

```ts
import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { sendMail } from '../../../../../services/mail';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    return Response.json(await sendMail(await req.json()));
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'send_failed' }, { status: 502 });
  }
}
```

Run: `npm test -- src/services/mail.test.ts` → PASS (3 tests).

- [ ] **Step 3: Point n8n at the adapter**

In `n8n/workflows/src/communication.workflow.mjs`, change the mail send call to include the agent key
(harmless extra header for Mailpit-era configs, required by the adapter):

```js
    await http({ method: 'POST', url: $env.MAIL_API_URL, json: true, headers: HEADERS, body: {
      From: { Email: $env.MAIL_FROM, Name: 'Sunday AI Work Recruiting' },
      To: [{ Email: p.to }],
      Subject: p.subject,
      Text: p.body,
    }});
```

In `docker-compose.yml`, change the n8n service's `MAIL_API_URL` to:

```yaml
      - MAIL_API_URL=http://host.docker.internal:3000/api/agent/mail/send
```

Append to `.env` and `.env.example`:

```
MAIL_PROVIDER=mailpit
MAILPIT_URL=http://localhost:8025
```

Re-verify the whole comms path through the adapter:

```bash
docker compose up -d
bash n8n/apply.sh
npm test
bash n8n/tests/communication.sh
```

Expected: full suite PASS; communication golden test passes end-to-end (mail now flows n8n → app adapter → Mailpit).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: provider-switched mail adapter — n8n executor is transport-agnostic"
```

---

### Task 8: GitHub remote + Amplify build spec

**Files:**
- Create: `amplify.yml`
- Remote: private GitHub repo `AgencyOS`

**Interfaces:**
- Consumes: the repo as-is.
- Produces: `github.com/<owner>/AgencyOS` (private, `main` pushed) — Amplify (Task 11) builds from it; `amplify.yml` at the repo root.

- [ ] **Step 1: Build spec**

Create `amplify.yml`:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
```

- [ ] **Step 2: Create the remote and push**

```bash
git add amplify.yml && git commit -m "chore: amplify build spec"
gh repo create AgencyOS --private --source . --push
gh repo view AgencyOS --json url -q .url
```

Expected: repo URL printed; `git log --oneline -1` matches the remote head. Confirm `.env*` never left the machine: `git ls-files | grep -c '^\.env'` → only `.env.example` appears.

---

### Task 9: Terraform base — VPC, Secrets, RDS

**Files:**
- Create: `infra/providers.tf`, `infra/variables.tf`, `infra/vpc.tf`, `infra/secrets.tf`, `infra/rds.tf`, `infra/outputs.tf`, `infra/.gitignore`, `infra/terraform.tfvars` (gitignored)

**Interfaces:**
- Consumes: AWS credentials configured locally (`aws sts get-caller-identity` works).
- Produces: VPC (public subnets, no NAT), Secrets Manager secret `agencyos/prod` (JSON: `db_password`, `n8n_db_password`, `agent_api_key`, `auth_secret`, `n8n_encryption_key`, `gemini_api_key`, `jobdiva_clientid`, `jobdiva_username`, `jobdiva_password`), RDS Postgres 17 (`agency` db, owned by the `agency` role; `n8n` db created by hand once, owned by a **separate** `n8n_service` role with `agency` database `CONNECT` explicitly revoked — n8n's ECS task (Task 10) must never hold credentials that can reach `agency`, since `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (Plan 1c) means any Code node can already read `$env.DB_POSTGRESDB_PASSWORD`), security groups. Outputs: `rds_endpoint`, `secret_arn`, plus later tasks' outputs. Tasks 10–11 reference `aws_vpc.this`… (module outputs), `aws_security_group.n8n`, `aws_db_instance.main`, `aws_secretsmanager_secret.main`.

- [ ] **Step 1: Scaffold**

Create `infra/.gitignore`:

```
.terraform/
*.tfstate
*.tfstate.*
terraform.tfvars
```

Create `infra/providers.tf`:

```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.aws_region
}
```

Create `infra/variables.tf`:

```hcl
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "admin_cidr" {
  type        = string
  description = "Admin workstation IP, e.g. 203.0.113.7/32"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "github_repository" {
  type        = string
  description = "e.g. https://github.com/<owner>/AgencyOS"
}

variable "github_token" {
  type      = string
  sensitive = true # repo-scope PAT for Amplify
}

variable "gemini_api_key" {
  type      = string
  sensitive = true
}

variable "jobdiva_clientid" {
  type      = string
  sensitive = true
}

variable "jobdiva_username" {
  type      = string
  sensitive = true
}

variable "jobdiva_password" {
  type      = string
  sensitive = true
}

variable "mail_from" {
  type    = string
  default = "rick@sundayaiwork.com"
}

variable "app_url" {
  type    = string
  default = "" # set after Task 11 pass 1, then re-apply
}
```

Create `infra/terraform.tfvars` (gitignored — real values):

```hcl
admin_cidr        = "<your-ip>/32"
github_repository = "https://github.com/<owner>/AgencyOS"
github_token      = "<github-pat-with-repo-scope>"
gemini_api_key    = "<gemini-key>"
jobdiva_clientid  = "<jobdiva-clientid>"
jobdiva_username  = "<jobdiva-username>"
jobdiva_password  = "<jobdiva-password>"
```

- [ ] **Step 2: VPC (public subnets, no NAT — cost posture; hardening path is private+NAT later)**

Create `infra/vpc.tf`:

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "agencyos"
  cidr = "10.0.0.0/16"

  azs            = ["${var.aws_region}a", "${var.aws_region}b"]
  public_subnets = ["10.0.1.0/24", "10.0.2.0/24"]

  enable_nat_gateway      = false
  map_public_ip_on_launch = true
}
```

- [ ] **Step 3: Secrets**

Create `infra/secrets.tf`:

```hcl
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "agent" {
  length  = 48
  special = false
}

resource "random_password" "auth" {
  length  = 48
  special = false
}

resource "random_password" "n8n_enc" {
  length  = 32
  special = false
}

resource "random_password" "n8n_db" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "main" {
  name = "agencyos/prod"
}

resource "aws_secretsmanager_secret_version" "main" {
  secret_id = aws_secretsmanager_secret.main.id
  secret_string = jsonencode({
    db_password        = random_password.db.result
    n8n_db_password    = random_password.n8n_db.result
    agent_api_key      = random_password.agent.result
    auth_secret        = random_password.auth.result
    n8n_encryption_key = random_password.n8n_enc.result
    gemini_api_key     = var.gemini_api_key
    jobdiva_clientid   = var.jobdiva_clientid
    jobdiva_username   = var.jobdiva_username
    jobdiva_password   = var.jobdiva_password
  })
}
```

- [ ] **Step 4: RDS**

Create `infra/rds.tf`:

```hcl
resource "aws_security_group" "rds" {
  name   = "agencyos-rds"
  vpc_id = module.vpc.vpc_id

  ingress {
    description = "admin workstation"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }
  ingress {
    description     = "n8n tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.n8n.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "agencyos"
  subnet_ids = module.vpc.public_subnets
}

resource "aws_db_instance" "main" {
  identifier     = "agencyos"
  engine         = "postgres"
  engine_version = "17"          # VERIFY: latest RDS-supported 17.x; pgvector ships as an extension
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true # candidate PII + resumes; cannot be enabled in place later

  db_name  = "agency"
  username = "agency"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = true   # SG-restricted to admin_cidr + n8n; private subnets + bastion is the hardening path

  backup_retention_period = 7
  skip_final_snapshot     = false
  final_snapshot_identifier = "agencyos-final"
}
```

Add to `infra/outputs.tf`:

```hcl
output "rds_endpoint" { value = aws_db_instance.main.endpoint }
output "secret_arn"   { value = aws_secretsmanager_secret.main.arn }
```

- [ ] **Step 5: Apply and initialize the databases**

(`aws_security_group.n8n` is defined in Task 10 — create Tasks 9 and 10's files, or temporarily comment that ingress block, before the first apply; the plan applies them together in Task 10 Step 4. For this task, verify with `terraform validate` after adding a placeholder:)

```bash
cd infra
terraform init
terraform validate
```

Expected: validate fails only on the not-yet-defined `aws_security_group.n8n` — acceptable; full apply happens in Task 10. If you prefer a green checkpoint now, comment the `n8n tasks` ingress block, run `terraform plan`, and restore it in Task 10.

- [ ] **Step 6: Commit**

```bash
git add infra/
git commit -m "feat(infra): terraform base — vpc, secrets, rds"
```

---

### Task 10: n8n on ECS Fargate behind an ALB

**Files:**
- Create: `infra/ecs.tf`, `infra/alb.tf`, `n8n/apply-remote.sh`
- Modify: `infra/outputs.tf`

**Interfaces:**
- Consumes: VPC/secrets/RDS (Task 9), workflow JSON from `n8n/build.mjs` (Plan 1c).
- Produces: `aws_security_group.n8n` (resolves Task 9's forward reference), Fargate service running `n8nio/n8n` backed by the RDS `n8n` database, ALB listener :80 → n8n :5678, output `n8n_url`. `n8n/apply-remote.sh` pushes/activates the repo's workflows on any n8n via its REST API (`N8N_REMOTE_URL`, `N8N_API_KEY`).

- [ ] **Step 1: ECS + ALB Terraform**

Create `infra/alb.tf`:

```hcl
resource "aws_security_group" "alb" {
  name   = "agencyos-alb"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "n8n" {
  name               = "agencyos-n8n"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnets
}

resource "aws_lb_target_group" "n8n" {
  name        = "agencyos-n8n"
  port        = 5678
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = module.vpc.vpc_id
  health_check { path = "/healthz" }
}

resource "aws_lb_listener" "n8n" {
  load_balancer_arn = aws_lb.n8n.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.n8n.arn
  }
}
```

Create `infra/ecs.tf`:

```hcl
resource "aws_security_group" "n8n" {
  name   = "agencyos-n8n-task"
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 5678
    to_port         = 5678
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_cluster" "main" {
  name = "agencyos"
}

resource "aws_cloudwatch_log_group" "n8n" {
  name              = "/agencyos/n8n"
  retention_in_days = 30
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "agencyos-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_secrets" {
  name = "agencyos-ecs-secrets"
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.main.arn]
    }]
  })
}

locals {
  rds_host = split(":", aws_db_instance.main.endpoint)[0]
}

resource "aws_ecs_task_definition" "n8n" {
  family                   = "agencyos-n8n"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([{
    name      = "n8n"
    image     = "n8nio/n8n:latest"
    essential = true
    portMappings = [{ containerPort = 5678, protocol = "tcp" }]
    environment = [
      { name = "DB_TYPE", value = "postgresdb" },
      { name = "DB_POSTGRESDB_HOST", value = local.rds_host },
      { name = "DB_POSTGRESDB_PORT", value = "5432" },
      { name = "DB_POSTGRESDB_DATABASE", value = "n8n" },
      // Dedicated role, scoped to the n8n database only — never the shared `agency` role/secret.
      // Its Postgres credentials sit in this task's env either way ($env is unblocked per Plan
      // 1c), so this role must be one that CONNECT to `agency` has been explicitly revoked from.
      { name = "DB_POSTGRESDB_USER", value = "n8n_service" },
      { name = "N8N_BLOCK_ENV_ACCESS_IN_NODE", value = "false" },
      { name = "NODE_FUNCTION_ALLOW_BUILTIN", value = "crypto" },
      { name = "GENERIC_TIMEZONE", value = "America/New_York" },
      { name = "WEBHOOK_URL", value = "http://${aws_lb.n8n.dns_name}/" },
      { name = "AGENCY_API_URL", value = var.app_url },
      { name = "MAIL_API_URL", value = "${var.app_url}/api/agent/mail/send" },
      { name = "MAIL_FROM", value = var.mail_from },
    ]
    secrets = [
      { name = "DB_POSTGRESDB_PASSWORD", valueFrom = "${aws_secretsmanager_secret.main.arn}:n8n_db_password::" },
      { name = "N8N_ENCRYPTION_KEY", valueFrom = "${aws_secretsmanager_secret.main.arn}:n8n_encryption_key::" },
      { name = "AGENT_API_KEY", valueFrom = "${aws_secretsmanager_secret.main.arn}:agent_api_key::" },
      { name = "GEMINI_API_KEY", valueFrom = "${aws_secretsmanager_secret.main.arn}:gemini_api_key::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.n8n.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "n8n"
      }
    }
  }])
}

resource "aws_ecs_service" "n8n" {
  name            = "n8n"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.n8n.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.public_subnets
    security_groups  = [aws_security_group.n8n.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.n8n.arn
    container_name   = "n8n"
    container_port   = 5678
  }
}
```

Add to `infra/outputs.tf`:

```hcl
output "n8n_url" { value = "http://${aws_lb.n8n.dns_name}" }
```

- [ ] **Step 2: Apply, create the n8n database, bootstrap n8n**

```bash
cd infra
terraform init && terraform validate && terraform apply
RDS=$(terraform output -raw rds_endpoint)
SECRETS=$(aws secretsmanager get-secret-value --secret-id agencyos/prod --query SecretString --output text)
DBPW=$(echo "$SECRETS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).db_password))")
N8NDBPW=$(echo "$SECRETS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).n8n_db_password))")

# n8n gets its own database AND its own role, scoped to that database only. It must never
# hold credentials that can reach `agency` — Plan 1c requires N8N_BLOCK_ENV_ACCESS_IN_NODE=false
# (so Code nodes can read AGENT_API_KEY/GEMINI_API_KEY), which means any Code node can already
# read whatever Postgres credentials sit in the n8n task's environment. Reusing the `agency`
# role for n8n's own DB connection would hand every workflow a direct, app-layer-bypassing
# path to candidates/decisions/PII — REVOKE CONNECT is what actually closes that, not just
# "n8n happens to point at a different database."
PGPASSWORD=$DBPW psql "host=${RDS%%:*} user=agency dbname=agency" <<SQL
CREATE ROLE n8n_service LOGIN PASSWORD '$N8NDBPW';
CREATE DATABASE n8n OWNER n8n_service;
REVOKE CONNECT ON DATABASE agency FROM PUBLIC;
GRANT CONNECT ON DATABASE agency TO agency;
SQL

cd ..
DATABASE_URL="postgres://agency:$DBPW@$RDS/agency" npm run db:migrate
DATABASE_URL="postgres://agency:$DBPW@$RDS/agency" npm run db:seed
```

Expected: apply succeeds; migrations (including `CREATE EXTENSION vector` and the HNSW index) run clean on RDS; seed prints the org + policy rows. Verify the role separation before moving on: `PGPASSWORD=$N8NDBPW psql "host=${RDS%%:*} user=n8n_service dbname=agency" -c 'select 1;'` must **fail** (`FATAL: permission denied for database "agency"`) — if it succeeds, the revoke didn't take and n8n can still reach the app's data. Open `$(terraform output -raw n8n_url)` — n8n's first-run owner-setup screen loads; create the owner account and, in Settings → API, create an API key (save it as `N8N_API_KEY` locally).

- [ ] **Step 3: Remote workflow deploy script**

Create `n8n/apply-remote.sh`:

```bash
#!/usr/bin/env bash
# Push repo workflows to a remote n8n via its public REST API and activate them.
# Usage: N8N_REMOTE_URL=http://<alb-dns> N8N_API_KEY=<key> bash n8n/apply-remote.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${N8N_REMOTE_URL:?set N8N_REMOTE_URL}" "${N8N_API_KEY:?set N8N_API_KEY}"

node n8n/build.mjs

EXISTING=$(curl -sf -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_REMOTE_URL/api/v1/workflows?limit=250")

for f in n8n/dist/*.json; do
  NAME=$(node -e "console.log(require('./$f').name)")
  BODY=$(node -e "
    const wf = require('./$f');
    // API accepts name/nodes/connections/settings; id/active are managed server-side.
    console.log(JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings }));
  ")
  ID=$(echo "$EXISTING" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const hit=(JSON.parse(s).data||[]).find(w=>w.name===process.argv[1]);
      console.log(hit?hit.id:'');
    })" "$NAME")
  if [ -n "$ID" ]; then
    curl -sf -X PUT -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'content-type: application/json' \
      -d "$BODY" "$N8N_REMOTE_URL/api/v1/workflows/$ID" > /dev/null
  else
    ID=$(curl -sf -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" -H 'content-type: application/json' \
      -d "$BODY" "$N8N_REMOTE_URL/api/v1/workflows" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
  fi
  curl -sf -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_REMOTE_URL/api/v1/workflows/$ID/activate" > /dev/null
  echo "deployed + activated: $NAME ($ID)"
done
```

```bash
chmod +x n8n/apply-remote.sh
N8N_REMOTE_URL=$(cd infra && terraform output -raw n8n_url) N8N_API_KEY=<key> bash n8n/apply-remote.sh
curl -s -X POST "$(cd infra && terraform output -raw n8n_url)/webhook/ping" -H 'content-type: application/json' -d '{}'
```

Expected: all six workflows deploy + activate; the ping webhook answers with n8n's started-acknowledgement. (The signal/source/screen chains will fail until `AGENCY_API_URL` is real — that lands in Task 11's second apply.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(infra): n8n on fargate behind alb + remote workflow deploy"
```

---

### Task 11: Amplify cockpit, S3, SES — and cutover

**Files:**
- Create: `infra/amplify.tf`, `infra/s3.tf`, `infra/ses.tf`
- Modify: `infra/outputs.tf`, `README.md`

**Interfaces:**
- Consumes: everything above; GitHub repo (Task 8); mail adapter (Task 7); runbook (Task 6).
- Produces: the production system — cockpit on Amplify (WEB_COMPUTE, SES-permitted SSR role), documents bucket, verified SES identity — plus the executed migration and the recorded JobDiva read-only date.

- [ ] **Step 1: S3 + SES Terraform**

Create `infra/s3.tf`:

```hcl
resource "random_id" "bucket" { byte_length = 4 }

resource "aws_s3_bucket" "documents" {
  bucket = "agencyos-documents-${random_id.bucket.hex}"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

Create `infra/ses.tf`:

```hcl
resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.mail_from
}
```

- [ ] **Step 2: Amplify Terraform**

Create `infra/amplify.tf`:

```hcl
data "aws_secretsmanager_secret_version" "main" {
  secret_id  = aws_secretsmanager_secret.main.id
  depends_on = [aws_secretsmanager_secret_version.main]
}

locals {
  secrets  = jsondecode(data.aws_secretsmanager_secret_version.main.secret_string)
  prod_db  = "postgres://agency:${local.secrets.db_password}@${aws_db_instance.main.endpoint}/agency"
}

data "aws_iam_policy_document" "amplify_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["amplify.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "amplify" {
  name               = "agencyos-amplify"
  assume_role_policy = data.aws_iam_policy_document.amplify_assume.json
}

resource "aws_iam_role_policy" "amplify_ses" {
  name = "agencyos-amplify-ses"
  role = aws_iam_role.amplify.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["ses:SendEmail"], Resource = aws_sesv2_email_identity.sender.arn }]
  })
}

resource "aws_amplify_app" "cockpit" {
  name                 = "agencyos"
  repository           = var.github_repository
  access_token         = var.github_token
  platform             = "WEB_COMPUTE"          # Next.js SSR
  iam_service_role_arn = aws_iam_role.amplify.arn

  # NOTE: Amplify env vars are visible in the console. Canonical copies live in
  # Secrets Manager; migrating the app to read Secrets Manager directly is a
  # hardening follow-up.
  environment_variables = {
    DATABASE_URL   = local.prod_db
    AGENT_API_KEY  = local.secrets.agent_api_key
    AUTH_SECRET    = local.secrets.auth_secret
    MAIL_PROVIDER  = "ses"
    AWS_REGION     = var.aws_region
  }
}

resource "aws_amplify_branch" "main" {
  app_id            = aws_amplify_app.cockpit.id
  branch_name       = "main"
  stage             = "PRODUCTION"
  enable_auto_build = true
}
```

Add to `infra/outputs.tf`:

```hcl
output "app_url"          { value = "https://main.${aws_amplify_app.cockpit.id}.amplifyapp.com" }
output "documents_bucket" { value = aws_s3_bucket.documents.bucket }
```

- [ ] **Step 3: Two-pass apply (app URL → n8n env)**

```bash
cd infra
terraform apply                                  # pass 1: creates Amplify
APP_URL=$(terraform output -raw app_url)
echo "app_url = \"$APP_URL\"" >> terraform.tfvars
terraform apply                                  # pass 2: injects AGENCY_API_URL/MAIL_API_URL into the n8n task
cd ..
```

Trigger the first Amplify build (push or console "Run build"), then click the SES verification email sent to `var.mail_from`. While SES is in sandbox, sends succeed only to verified addresses — request production access in the SES console (runbook note); until then, test with your own verified address.

- [ ] **Step 4: Production smoke**

```bash
APP_URL=$(cd infra && terraform output -raw app_url)
N8N_URL=$(cd infra && terraform output -raw n8n_url)
KEY=$(aws secretsmanager get-secret-value --secret-id agencyos/prod --query SecretString --output text | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).agent_api_key))")
ORG_ID=$(curl -s "$APP_URL/api/agent/decisions?org_id=00000000-0000-7000-8000-000000000000" -H "x-agent-api-key: $KEY" > /dev/null; PGPASSWORD=$DBPW psql "host=${RDS%%:*} user=agency dbname=agency" -tA -c "select id from orgs where name='Sunday AI Work'")

curl -s -o /dev/null -w 'login page: %{http_code}\n' "$APP_URL/login"                      # expect 200
curl -s -X POST "$APP_URL/api/agent/decisions" -H "x-agent-api-key: $KEY" -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"agent\":\"screening\",\"action_class\":\"client.submit_candidate\",\"reasoning\":{\"summary\":\"prod smoke\",\"evidence\":[],\"model\":\"manual\",\"prompt_version\":\"v0\"},\"payload\":{}}" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('decision state:',JSON.parse(s).decision.state))"   # expect proposed
curl -s -X POST "$N8N_URL/webhook/signal" -H 'content-type: application/json' \
  -d "{\"org_id\":\"$ORG_ID\",\"type\":\"prod.smoke\",\"payload\":{}}"                       # → risk card
curl -s "$APP_URL/api/agent/decisions?org_id=$ORG_ID" -H "x-agent-api-key: $KEY" | grep -c 'prod.smoke'  # expect ≥1
curl -s -X POST "$APP_URL/api/agent/mail/send" -H "x-agent-api-key: $KEY" -H 'content-type: application/json' \
  -d "{\"From\":{\"Email\":\"rick@sundayaiwork.com\",\"Name\":\"AgencyOS\"},\"To\":[{\"Email\":\"rick@sundayaiwork.com\"}],\"Subject\":\"AgencyOS prod smoke\",\"Text\":\"SES path works.\"}"
```

Expected: login 200; decision `proposed`; the n8n signal produces a risk card visible via the prod queue API (and in the cockpit); the SES smoke email arrives in your inbox. Also log in at `$APP_URL` (seeded dev credentials) and **immediately change the password**:

```bash
NEWHASH=$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" '<new-strong-password>')
PGPASSWORD=$DBPW psql "host=${RDS%%:*} user=agency dbname=agency" -c "update users set password_hash='$NEWHASH' where email='rick@sundayaiwork.com'"
```

- [ ] **Step 5: Run the migration for real (runbook §4–7)**

Follow `docs/MIGRATION.md` against RDS:

```bash
export DATABASE_URL="postgres://agency:$DBPW@$RDS/agency"
npx tsx scripts/migration/run-import.ts --since 2015-01-01          # hours; resumable
npx tsx scripts/migration/backfill-embeddings.ts
npx tsx scripts/migration/report.ts
```

Reconcile the report against JobDiva's counts. When they match: stop editing in JobDiva and record the
cutover in `Agentic_Recruiting/Project_State.md` ("JobDiva read-only as of <date>; AgencyOS is the ATS of
record"). Verify the migrated book in the cockpit: `/candidates` and `/jobs` show the real data; run one
`job_order.created` signal against a real job and watch the spine produce a shortlist.

- [ ] **Step 6: README + commit**

Append to `README.md`:

```markdown
## Production (Phase 1d)

- Infra: `infra/` (Terraform). `terraform apply` in two passes (see plan Task 11).
- Cockpit: AWS Amplify (auto-builds from `main`). n8n: ECS Fargate behind an ALB
  (`terraform output n8n_url`); deploy workflows with `n8n/apply-remote.sh`.
- Mail: `MAIL_PROVIDER=ses` in prod, `mailpit` in dev — same adapter endpoint.
- Secrets: Secrets Manager `agencyos/prod`. RDS is SG-restricted (your IP + n8n).
- Migration: `docs/MIGRATION.md`. JobDiva is read-only after cutover.
- Hardening backlog: TLS + domain on the ALB and Amplify, private subnets + NAT,
  Amplify env vars → Secrets Manager reads, SES production access.
```

```bash
git add -A
git commit -m "feat(infra): amplify cockpit, s3, ses + production cutover"
git push
```

---

## Self-Review Results

- **Spec coverage (Plan 1d scope, spec §6):** Amplify Hosting for the cockpit ✓ (Task 11, WEB_COMPUTE + SES-permitted SSR role); RDS Postgres single instance + pgvector ✓ (Task 9; `n8n` database on the same instance — spec's "its own small RDS database" read as its own *database*, split to a second instance later if n8n load warrants); S3 for resumes/documents ✓ (Task 11; Phase-1 resume text stays in `parsed_text`, bucket ready for raw files); n8n self-hosted on ECS Fargate ✓ (Task 10); SES as email transport behind the Communication Agent with providers as swappable config ✓ (Task 7 adapter + Task 11 identity); Secrets Manager + single VPC + IaC ✓ (Task 9, Terraform per spec's implementer's-choice); JobDiva one-way migration early in phase, then read-only ✓ (Tasks 1–6, executed in Task 11 Step 5 with the cutover recorded). Deliberately deferred with a documented path: TLS/domain, private subnets + NAT, Amplify env-var hardening, SES production access.
- **Placeholders:** none — every step has full code, config, or exact commands. The two live-API touchpoints (fixture capture, real import) are explicit and capped; unit tests stub all networks.
- **Type consistency:** `JobDivaClient`/`BiRow`/`rows()` (Task 2) consumed by Tasks 3–4 under the same names; `mapCandidate`/`mapJob`/`pickLatestResume` (Task 3) match Task 4's usage; `chunkText`/`sha256` (Task 3) match Task 5 and mirror `helpers.js` semantics; `runImport(opts) → { jobs, candidates, resumes, skipped }` matches its tests; `ingestCandidate`/`upsertEmbeddings` signatures match Plan 1c Task 4; `sendMail` payload shape matches what `communication.workflow.mjs` posts (Plan 1c Task 12 + Task 7 modification); Terraform references (`aws_security_group.n8n` forward-declared in Task 9, defined Task 10; `var.app_url` two-pass) are called out where they occur.
- **Build-session verification points (flagged inline):** JobDiva authenticate path + `NewUpdatedCandidateRecords` endpoint name + BI date format (fixture capture resolves all three before anything depends on them); RDS `engine_version = "17"` exact minor; n8n REST API payload accepted fields on the installed version; Amplify WEB_COMPUTE build defaults for Next.js 15.
- **Grilled 2026-07-11:** the original Task 10 gave n8n's ECS task the same Postgres role/password as the `agency` app database — directly contradicting Plan 1c's stated hard rule ("no Postgres credentials in n8n"), and immediately reachable in practice since Plan 1c already requires `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (any Code node can read `$env.DB_POSTGRESDB_PASSWORD`). Fixed with a dedicated `n8n_service` role scoped to n8n's own database, `CONNECT` on `agency` revoked from `PUBLIC`, and a bootstrap step that verifies the revoke actually took. See ADR-0005.
