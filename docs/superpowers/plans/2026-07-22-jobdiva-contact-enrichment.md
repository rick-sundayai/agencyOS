# JobDiva Contact Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich JobDiva-sourced candidates with email/phone from `/apiv2/bi/CandidateDetail` at import time, excluding candidates with no usable email, so screening drafts outreach instead of dead-ending in `risk.alert`.

**Architecture:** One new read-only method on the `JobDivaClient` (`getCandidateContact`); the exclusion policy and call ordering live in `importCandidatesForJob` (contact lookup → exclude → resume fetch → ingest → embed). `ingestCandidate` is untouched — its existing merge backfills email onto known candidates. Spec: `docs/superpowers/specs/2026-07-22-jobdiva-contact-enrichment-design.md`.

**Tech Stack:** TypeScript/Next.js app services, vitest (existing `fakeFetch` pattern in `jobdiva.test.ts`; real-DB + mocked-deps pattern in `jobdiva-import.test.ts`), live JobDiva production API (read-only), local stack for acceptance.

## Global Constraints

- **JobDiva is production, read-only.** Only GET/detail/search endpoints; `CandidateDetail` joins the existing allowed set. Never any write/mutation endpoint.
- **No speculative field-name fallbacks** (established posture, enforced by prior review): the client reads the exact field names confirmed live in Task 1 — one key per field, no `??` chains across alternate keys.
- **Candidate PII is never printed**: probe/smoke output shows field *names* and presence booleans only, never email/phone values. Never print env secret values.
- "Usable email" = non-empty after `.trim()` AND passes zod `z.email()`; otherwise the hit is excluded (not crashed).
- Solo-dev convention: commit straight to `main`, no branches.
- Working stack assumed up from the smoke-test session (docker compose db/n8n/mailpit, dev server on :3000). No n8n workflow changes are needed — enrichment is entirely app-side.

---

### Task 1: Live probe — confirm `CandidateDetail`'s real field names

**Files:**
- Create: `/private/tmp/claude-501/-Users-richardlove-Desktop-Projects-AgencyOS/537be278-cd4d-46b0-a23f-a78a0d85efdb/scratchpad/probe-candidate-detail.ts` (throwaway, never committed)

**Interfaces:**
- Produces: the confirmed field names (e.g. whether email lives in `EMAIL`, `EMAILADDRESS`, …) and the confirmed request param name for the candidate id. Task 2's mapping and tests substitute these names verbatim.

- [ ] **Step 1: Write the probe script.** It authenticates exactly like the client, runs `JobAgentSearch` for job `23-00053` to get a real candidate id, calls `CandidateDetail`, and prints ONLY field names + presence booleans:

```ts
// probe-candidate-detail.ts — throwaway; prints field NAMES only, never values.
import 'dotenv/config';

const base = (process.env.JOBDIVA_BASE_URL ?? 'https://api.jobdiva.com').replace(/\/$/, '');

async function main() {
  const auth = await fetch(
    `${base}/api/authenticate?clientid=${encodeURIComponent(process.env.JOBDIVA_CLIENT_ID!)}` +
    `&username=${encodeURIComponent(process.env.JOBDIVA_USERNAME!)}` +
    `&password=${encodeURIComponent(process.env.JOBDIVA_PASSWORD!)}`,
  );
  const token = (await auth.text()).trim().replace(/^"|"$/g, '');
  const h = { Authorization: `Bearer ${token}` };

  // Resolve internal job id, then one search hit (mirrors the shipped client's flow).
  const jd = await (await fetch(`${base}/apiv2/bi/JobDetail?jobdivaref=23-00053`, { headers: h })).json();
  const jobRow = Array.isArray(jd) ? jd[0] : jd?.data?.[0];
  const search = await (await fetch(`${base}/apiv2/jobdiva/JobAgentSearch?jobId=${jobRow.ID}&resumeCount=1`, { headers: h })).json();
  const hit = Array.isArray(search) ? search[0] : search?.data?.[0];
  if (!hit) throw new Error('no search hit — pick another job number');

  const cd = await (await fetch(`${base}/apiv2/bi/CandidateDetail?candidateid=${hit.CANDIDATEID}`, { headers: h })).json();
  const row = Array.isArray(cd) ? cd[0] : cd?.data?.[0];
  if (!row) { console.log('CandidateDetail raw shape:', JSON.stringify(Object.keys(cd ?? {}))); throw new Error('no row — check param name (try id=, candidateId=)'); }

  for (const k of Object.keys(row)) {
    const v = row[k];
    console.log(`${k}: ${v === null || v === '' ? 'EMPTY' : typeof v}${/mail|phone/i.test(k) ? '  <-- CONTACT?' : ''}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `npx tsx /private/tmp/claude-501/-Users-richardlove-Desktop-Projects-AgencyOS/537be278-cd4d-46b0-a23f-a78a0d85efdb/scratchpad/probe-candidate-detail.ts`
Expected: a list of `FIELDNAME: type` lines with `<-- CONTACT?` markers on email/phone-ish keys. If the `candidateid=` param yields no row, try the alternates the error suggests, and record which one worked. **Record: the working param name, the exact email field key, the exact phone field key, and whether the test candidate's email is EMPTY or present** — Task 2 and the acceptance run depend on all four.

- [ ] **Step 3: No commit** (script lives in scratchpad only). Report the four recorded facts.

---

### Task 2: Client method `getCandidateContact` + smoke-script extension (TDD)

**Files:**
- Modify: `src/services/jobdiva.ts` (add method to `JobDivaClient` type + implementation)
- Modify: `src/services/jobdiva.test.ts` (new tests)
- Modify: `scripts/jobdiva-smoke.ts` (print contact field presence for first hit)

**Interfaces:**
- Consumes: Task 1's confirmed names. The code below uses `candidateid` (param), `EMAIL`, `PHONE` — **substitute the confirmed names verbatim if Task 1 found different ones.**
- Produces: `getCandidateContact(jobdivaCandidateId: string): Promise<{ email: string | null; phone: string | null }>` on `JobDivaClient`. Task 3 relies on exactly this signature.

- [ ] **Step 1: Write the failing tests** (append to `src/services/jobdiva.test.ts`, reusing its existing `fakeFetch` + `CFG` helpers):

```ts
describe('getCandidateContact', () => {
  it('reads email and phone from CandidateDetail', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('/apiv2/bi/CandidateDetail') && url.includes('candidateid=cand-1')) {
        return { body: { data: [{ CANDIDATEID: 'cand-1', EMAIL: 'person@example.com', PHONE: '555-0100' }] } };
      }
      return { status: 404, body: 'nope' };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    expect(await client.getCandidateContact('cand-1')).toEqual({
      email: 'person@example.com', phone: '555-0100',
    });
  });

  it('returns nulls when the row has empty contact fields', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('/apiv2/bi/CandidateDetail')) return { body: [{ CANDIDATEID: 'cand-2', EMAIL: '', PHONE: null }] };
      return { status: 404, body: 'nope' };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    expect(await client.getCandidateContact('cand-2')).toEqual({ email: null, phone: null });
  });

  it('returns nulls when CandidateDetail has no row for the id', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('/apiv2/bi/CandidateDetail')) return { body: { data: [] } };
      return { status: 404, body: 'nope' };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    expect(await client.getCandidateContact('cand-3')).toEqual({ email: null, phone: null });
  });

  it('throws on a non-200 from CandidateDetail', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      return { status: 500, body: 'boom' };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    await expect(client.getCandidateContact('cand-4')).rejects.toThrow(/getCandidateContact failed: 500/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/jobdiva.test.ts`
Expected: FAIL — `getCandidateContact is not a function` (plus type error if `tsc` is run: not on `JobDivaClient`).

- [ ] **Step 3: Implement.** Add to the `JobDivaClient` type in `src/services/jobdiva.ts`:

```ts
  // Contact details from /apiv2/bi/CandidateDetail — used by import-time enrichment.
  // Field mapping live-verified <date> against production (see enrichment spec).
  getCandidateContact(jobdivaCandidateId: string): Promise<{ email: string | null; phone: string | null }>;
```

Implementation inside `makeJobDivaClient` — mirror `getResumeText`'s shape exactly: same authenticated-GET helper this file already uses for BI calls, same `biRows()` envelope handling, same error style (`throw new Error('getCandidateContact failed: ' + res.status)` on `!res.ok`). Read ONLY the confirmed keys (one key per field, no fallback chains):

```ts
    async getCandidateContact(jobdivaCandidateId) {
      const rows = biRows(await biGet('/apiv2/bi/CandidateDetail', { candidateid: jobdivaCandidateId }, 'getCandidateContact'));
      const row = rows[0];
      if (!row) return { email: null, phone: null };
      const email = typeof row.EMAIL === 'string' && row.EMAIL.trim() !== '' ? row.EMAIL.trim() : null;
      const phone = typeof row.PHONE === 'string' && row.PHONE.trim() !== '' ? row.PHONE.trim() : null;
      return { email, phone };
    },
```

(`biGet` here stands for the file's existing authenticated BI GET helper used by `getResumeText` — reuse it under whatever name it actually has in the file; do not add a second request helper.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/services/jobdiva.test.ts && npx tsc --noEmit`
Expected: all tests PASS (previous suites included), tsc clean. Note: adding a method to `JobDivaClient` will break the mock clients in `src/services/jobdiva-import.test.ts` typing — if tsc flags them, add a stub `getCandidateContact: vi.fn(async () => ({ email: null, phone: null }))` to those mocks now (Task 3 rewrites their behavior anyway).

- [ ] **Step 5: Extend the smoke script.** In `scripts/jobdiva-smoke.ts`, after the existing `getResumeText` block, append:

```ts
  if (candidates[0]) {
    const contact = await client.getCandidateContact(candidates[0].jobdiva_id);
    console.log('getCandidateContact:', { has_email: contact.email !== null, has_phone: contact.phone !== null });
  }
```

(Presence booleans only — never the values.)

- [ ] **Step 6: Live smoke**

Run: `npx tsx scripts/jobdiva-smoke.ts 23-00053`
Expected: previous three calls green plus `getCandidateContact: { has_email: <bool>, has_phone: <bool> }` matching Task 1's observation.

- [ ] **Step 7: Commit**

```bash
git add src/services/jobdiva.ts src/services/jobdiva.test.ts scripts/jobdiva-smoke.ts
git commit -m "feat: JobDiva getCandidateContact via BI CandidateDetail (live-verified)"
```

---

### Task 3: Import-flow enrichment + no-email exclusion + `no_email` stat (TDD)

**Files:**
- Modify: `src/contracts/sourcing.ts` (add `no_email?: number` to `SourcingStats`)
- Modify: `src/services/jobdiva-import.ts`
- Modify: `src/services/jobdiva-import.test.ts`

**Interfaces:**
- Consumes: `getCandidateContact(jobdivaCandidateId)` from Task 2 (exact signature above); existing `ingestCandidate` input fields `email`/`phone`; existing `SourcingStats` keys `jobdiva_found`/`jobdiva_new`/`embedded`/`skipped`.
- Produces: `importCandidatesForJob` return type becomes `Required<Pick<SourcingStats, 'jobdiva_found' | 'jobdiva_new' | 'embedded' | 'skipped' | 'no_email'>>`; per-hit order contact → exclude → resume → ingest → embed.

- [ ] **Step 1: Add `no_email` to the contract.** In `src/contracts/sourcing.ts`, add to the `SourcingStats` type alongside the existing optional numeric fields:

```ts
  /** JobDiva hits excluded at import because CandidateDetail had no usable email. */
  no_email?: number;
```

- [ ] **Step 2: Write the failing tests** in `src/services/jobdiva-import.test.ts`, following that file's existing pattern (real DB with a fresh fixture org, mocked `JobDivaClient` + `embed`). Give every mock client the new method, then add:

```ts
  it('excludes a hit with no usable email — no resume fetch, no candidate row', async () => {
    const jobdiva = {
      getJob: vi.fn(), 
      searchCandidates: vi.fn(async () => [{
        jobdiva_id: 'jd-noemail', full_name: 'No Email', email: null, phone: null,
        current_title: null, location: null,
      }]),
      getResumeText: vi.fn(async () => 'resume text'),
      getCandidateContact: vi.fn(async () => ({ email: null, phone: '555-0100' })),
    };
    const out = await importCandidatesForJob(
      { org_id: org, job_order_id: jobId },
      { jobdiva, embed: vi.fn(async () => vec()) },
    );
    expect(out.no_email).toBe(1);
    expect(out.jobdiva_new).toBe(0);
    expect(jobdiva.getResumeText).not.toHaveBeenCalled(); // excluded BEFORE the expensive call
    const rows = await db.select().from(candidates)
      .where(and(eq(candidates.org_id, org), eq(candidates.jobdiva_id, 'jd-noemail')));
    expect(rows).toHaveLength(0);
  });

  it('treats a malformed email as no-email', async () => {
    const jobdiva = {
      getJob: vi.fn(),
      searchCandidates: vi.fn(async () => [{
        jobdiva_id: 'jd-badmail', full_name: 'Bad Mail', email: null, phone: null,
        current_title: null, location: null,
      }]),
      getResumeText: vi.fn(async () => 'resume text'),
      getCandidateContact: vi.fn(async () => ({ email: 'not-an-email', phone: null })),
    };
    const out = await importCandidatesForJob(
      { org_id: org, job_order_id: jobId },
      { jobdiva, embed: vi.fn(async () => vec()) },
    );
    expect(out.no_email).toBe(1);
    expect(jobdiva.getResumeText).not.toHaveBeenCalled();
  });

  it('ingests an enriched hit with email and phone from CandidateDetail', async () => {
    const jobdiva = {
      getJob: vi.fn(),
      searchCandidates: vi.fn(async () => [{
        jobdiva_id: 'jd-rich', full_name: 'Has Email', email: null, phone: null,
        current_title: 'Analyst', location: null,
      }]),
      getResumeText: vi.fn(async () => 'resume text'),
      getCandidateContact: vi.fn(async () => ({ email: 'Person@Example.com ', phone: '555-0101' })),
    };
    const out = await importCandidatesForJob(
      { org_id: org, job_order_id: jobId },
      { jobdiva, embed: vi.fn(async () => vec()) },
    );
    expect(out.jobdiva_new).toBe(1);
    expect(out.no_email).toBe(0);
    const [row] = await db.select().from(candidates)
      .where(and(eq(candidates.org_id, org), eq(candidates.jobdiva_id, 'jd-rich')));
    expect(row.email).toBe('Person@Example.com'.trim()); // trimmed, case preserved
    expect(row.phone).toBe('555-0101');
  });

  it('backfills email onto an already-known candidate', async () => {
    await ingestCandidate({
      org_id: org, full_name: 'Known Person', email: null, phone: null,
      current_title: null, location: null, source: 'jobdiva',
      jobdiva_id: 'jd-known', resume_text: 'old resume',
    });
    const jobdiva = {
      getJob: vi.fn(),
      searchCandidates: vi.fn(async () => [{
        jobdiva_id: 'jd-known', full_name: 'Known Person', email: null, phone: null,
        current_title: null, location: null,
      }]),
      getResumeText: vi.fn(async () => null),
      getCandidateContact: vi.fn(async () => ({ email: 'known@example.com', phone: null })),
    };
    await importCandidatesForJob(
      { org_id: org, job_order_id: jobId },
      { jobdiva, embed: vi.fn(async () => vec()) },
    );
    const [row] = await db.select().from(candidates)
      .where(and(eq(candidates.org_id, org), eq(candidates.jobdiva_id, 'jd-known')));
    expect(row.email).toBe('known@example.com');
  });

  it('a throwing getCandidateContact skips that candidate but not the batch', async () => {
    const jobdiva = {
      getJob: vi.fn(),
      searchCandidates: vi.fn(async () => [
        { jobdiva_id: 'jd-boom', full_name: 'Boom', email: null, phone: null, current_title: null, location: null },
        { jobdiva_id: 'jd-ok', full_name: 'Ok Person', email: null, phone: null, current_title: null, location: null },
      ]),
      getResumeText: vi.fn(async () => 'resume text'),
      getCandidateContact: vi.fn(async (id: string) => {
        if (id === 'jd-boom') throw new Error('jobdiva 500');
        return { email: 'ok@example.com', phone: null };
      }),
    };
    const out = await importCandidatesForJob(
      { org_id: org, job_order_id: jobId },
      { jobdiva, embed: vi.fn(async () => vec()) },
    );
    expect(out.skipped).toBe(1);
    expect(out.jobdiva_new).toBe(1);
  });
```

(Adapt fixture/helper names — `org`, `jobId`, `vec()` — to the file's existing setup helpers; the file already creates a fresh org and a job order with `jobdiva_id` set. Reuse them, don't invent parallel fixtures.)

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/services/jobdiva-import.test.ts`
Expected: FAIL — `no_email` undefined on the return type; exclusion tests fail because the current flow ingests everything.

- [ ] **Step 4: Implement in `src/services/jobdiva-import.ts`.** Changes:

1. Return type: `Required<Pick<SourcingStats, 'jobdiva_found' | 'jobdiva_new' | 'embedded' | 'skipped' | 'no_email'>>`.
2. Add a module-scope validator next to the existing helpers: `const EmailSchema = z.email();` (import `z` from `'zod'`).
3. Counter `let no_email = 0;` alongside the existing counters.
4. New per-hit order — inside the existing `try`, BEFORE the `needsResume`/resume-fetch block:

```ts
      const contact = await deps.jobdiva.getCandidateContact(hit.jobdiva_id);
      const email = contact.email && EmailSchema.safeParse(contact.email.trim()).success
        ? contact.email.trim() : null;
      if (!email) { no_email++; continue; }  // excluded before the expensive resume fetch
```

5. Pass enrichment into ingest: `email`, `phone: contact.phone ?? hit.phone` (the hit's own fields stay as fallback-of-record; search currently returns nulls for both).
6. Include `no_email` in the returned stats object and the `updateSourcingRun` call.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/services/jobdiva-import.test.ts src/services/jobdiva.test.ts src/contracts/sourcing.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Full suite once before committing**

Run: `npm test`
Expected: green (the `ats-views` flake is a known pre-existing exception; anything else that fails, investigate before committing).

- [ ] **Step 7: Commit**

```bash
git add src/contracts/sourcing.ts src/services/jobdiva-import.ts src/services/jobdiva-import.test.ts
git commit -m "feat: enrich JobDiva imports with CandidateDetail contact, exclude no-email hits"
```

---

### Task 4: Live acceptance run — the outreach payoff

**Files:**
- Modify: `docs/superpowers/reports/2026-07-22-live-sourcing-smoke-test-report.md` (append an "Enrichment acceptance" section)
- Modify: `docs/superpowers/specs/2026-07-22-jobdiva-contact-enrichment-design.md` (Status line)

**Interfaces:**
- Consumes: everything above, plus the running local stack. No n8n rebuild needed (all changes are app-side; Next dev hot-reloads services).

- [ ] **Step 1: Re-source from the UI.** Logged in at http://localhost:3000, open the "Product Analyst - Salesforce" job page and click **Source candidates**. Wait for phase `done` (poll `select phase, stats from sourcing_runs order by created_at desc limit 1;` via `docker compose exec -T db psql -U agency -d agency`).

- [ ] **Step 2: Branch on what Task 1 recorded about the test candidate's email.**

**If JobDiva has an email for them** — verify the full outreach path:

```bash
docker compose exec -T db psql -U agency -d agency -c "
select 'email_backfilled' as check, (email is not null)::text as value from candidates where jobdiva_id is not null and org_id=(select id from orgs where name='Sunday AI Work')
union all select 'comms_decision', string_agg(action_class || ':' || state, ', ') from decisions where action_class like 'comms.%'
union all select 'risk_alerts_new', count(*)::text from decisions where action_class='risk.alert' and state='proposed';"
```

Expected: `email_backfilled = true`; a `comms.*` decision exists (state per its tier policy); `risk_alerts_new = 0` (no new "no email on file" alert). Then check Mailpit (`http://localhost:8025`) — if the comms decision auto-executed, the drafted email is there; if it's pending in the Cockpit, disposition it as Rick directs, then check Mailpit. **Nothing may leave the machine** — Mailpit is the only mail sink locally.

**If JobDiva has no email for them** — the run keeps them via backfill-miss and re-alerts (import-only exclusion, working as designed). Verify the exclusion path instead: ask Rick for a second job number with fresh candidates, source it, and assert `stats.no_email >= 1` with no candidate rows added for the excluded hits.

- [ ] **Step 3: Append results to the report** (run stats, the SQL output, Mailpit outcome, screenshots if useful) and set the enrichment spec's Status line to `Executed <date> — see report`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/reports/2026-07-22-live-sourcing-smoke-test-report.md docs/superpowers/specs/2026-07-22-jobdiva-contact-enrichment-design.md
git commit -m "docs: JobDiva contact enrichment acceptance results"
```
