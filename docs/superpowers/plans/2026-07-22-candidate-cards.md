# Candidate Cards: Honest Fit Language + Job-Order Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw embedding-distance chip on a job order's sourcing shortlist with a
plain-English match tier, and let a recruiter filter the Candidates grid down to one job order.

**Architecture:** A new shared `src/components/fit.ts` module consolidates the `FIT` label/tone
lookup (currently copy-pasted three times) and adds a `matchTier()` sibling for pre-screening
similarity. `SourcingPanel` switches between the real fit-badge (once screened) and the match-tier
chip (before screening) — never both, never the raw number. `listCandidates` gains an optional
job-order filter via a subquery against `applications`; a small client-side `<select>` island
drives it through the `?job=` URL param so the Candidates page stays server-rendered.

**Tech Stack:** Next.js 16 App Router (server components + minimal client islands), Drizzle ORM,
Postgres, Vitest + React Testing Library.

## Global Constraints

- No changes to the candidate detail page beyond the shared `fit.ts` import swap — it already
  renders correctly.
- No changes to the Pipeline board's card rendering (separate sub-project).
- No quick actions (copy email, open resume, etc.) added to any candidate card.
- No fix to garbled `current_title` data — that's upstream data quality, out of scope.
- `matchTier()` uses exactly the 0.55 cosine-distance threshold already documented in
  `CONTEXT.md` as "good match" — no new/invented thresholds.
- Never show both a fit-badge and a match-tier chip on the same shortlist card, and never show
  the raw `distance` number in the UI.

---

### Task 1: Shared `fit.ts` module

**Files:**
- Create: `src/components/fit.ts`
- Test: `src/components/fit.test.ts`

**Interfaces:**
- Produces: `fitMeta(rating: string | null | undefined): { label: string; tone: string } | null`
- Produces: `matchTier(distance: number): { label: string; tone: string }`

- [ ] **Step 1: Write the failing test**

Create `src/components/fit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fitMeta, matchTier } from './fit';

describe('fitMeta', () => {
  it('resolves a known rating to its label and tone', () => {
    expect(fitMeta('yes')).toEqual({ label: 'Strong fit', tone: 'fit-good' });
    expect(fitMeta('borderline')).toEqual({ label: 'Borderline', tone: 'fit-warn' });
    expect(fitMeta('no')).toEqual({ label: 'Poor fit', tone: 'fit-bad' });
  });

  it('returns null for a null, undefined, or unrecognized rating', () => {
    expect(fitMeta(null)).toBeNull();
    expect(fitMeta(undefined)).toBeNull();
    expect(fitMeta('unknown')).toBeNull();
  });
});

describe('matchTier', () => {
  it('labels a distance below the 0.55 threshold as a close match', () => {
    expect(matchTier(0.2)).toEqual({ label: 'Close match', tone: 'match-close' });
    expect(matchTier(0.549)).toEqual({ label: 'Close match', tone: 'match-close' });
  });

  it('labels a distance at or above the 0.55 threshold as a possible match', () => {
    expect(matchTier(0.55)).toEqual({ label: 'Possible match', tone: 'match-possible' });
    expect(matchTier(0.9)).toEqual({ label: 'Possible match', tone: 'match-possible' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/fit.test.ts`
Expected: FAIL — `Cannot find module './fit'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/components/fit.ts`:

```ts
/**
 * Fit rating + match-tier display, single-sourced so a candidate's fit reads the same
 * everywhere it appears (Candidates grid, candidate detail, sourcing shortlist).
 */
const FIT_DISPLAY: Record<string, { label: string; tone: string }> = {
  yes: { label: 'Strong fit', tone: 'fit-good' },
  borderline: { label: 'Borderline', tone: 'fit-warn' },
  no: { label: 'Poor fit', tone: 'fit-bad' },
};

/** Resolve a fit_rating to its label + tone. Null for an unset or unrecognized rating. */
export function fitMeta(rating: string | null | undefined): { label: string; tone: string } | null {
  return rating ? (FIT_DISPLAY[rating] ?? null) : null;
}

// Pre-screening cosine-distance signal → a plain-English match tier, using the same 0.55
// "good match" threshold the sourcing service already applies internally (see CONTEXT.md).
const MATCH_THRESHOLD = 0.55;

/** Resolve an embedding distance (0 = identical) to a match tier — the pre-screening
 * counterpart to fitMeta(), shown only until a real fit_rating exists for the candidate. */
export function matchTier(distance: number): { label: string; tone: string } {
  return distance < MATCH_THRESHOLD
    ? { label: 'Close match', tone: 'match-close' }
    : { label: 'Possible match', tone: 'match-possible' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/fit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/fit.ts src/components/fit.test.ts
git commit -m "feat: add shared fit.ts with fitMeta + matchTier"
```

---

### Task 2: Consolidate `candidates/page.tsx` onto `fit.ts`

**Files:**
- Modify: `src/app/candidates/page.tsx`

**Interfaces:**
- Consumes: `fitMeta` from Task 1 (`../../components/fit`)

- [ ] **Step 1: Remove the local `FIT` table and `fitTone` helper, import `fitMeta`**

In `src/app/candidates/page.tsx`, replace lines 1–11:

```ts
import Link from 'next/link';
import { auth } from '../../lib/auth';
import { listCandidates } from '../../services/ats-views';

// fit_rating → operator-facing label + tone class. Mirrors the domain values in
// intelligence.scores ('yes' | 'borderline' | 'no').
const FIT: Record<string, { label: string; tone: string }> = {
  yes: { label: 'Strong fit', tone: 'fit-good' },
  borderline: { label: 'Borderline', tone: 'fit-warn' },
  no: { label: 'Poor fit', tone: 'fit-bad' },
};
```

with:

```ts
import Link from 'next/link';
import { auth } from '../../lib/auth';
import { listCandidates } from '../../services/ats-views';
import { fitMeta } from '../../components/fit';
```

- [ ] **Step 2: Swap the `FIT[...]` lookup for `fitMeta(...)`**

Replace:

```ts
            const fit = c.score?.fit_rating ? FIT[c.score.fit_rating] : null;
```

with:

```ts
            const fit = fitMeta(c.score?.fit_rating);
```

- [ ] **Step 3: Replace the `fitTone(...)` call with the already-computed `fit.tone`**

Replace:

```tsx
                  {ring && (
                    <span className={`fit-ring ${fitTone(c.score?.fit_rating)}`} role="img"
```

with:

```tsx
                  {ring && (
                    <span className={`fit-ring ${fit?.tone ?? ''}`} role="img"
```

- [ ] **Step 4: Delete the now-unused `fitTone` function**

Remove:

```ts
function fitTone(rating: string | null | undefined): string {
  return rating ? (FIT[rating]?.tone ?? '') : '';
}
```

- [ ] **Step 5: Verify with build + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (no dedicated test file covers this route today; this is a behavior-preserving
refactor — the JSX output is unchanged since `fitMeta` returns the exact same shape as the old
`FIT[...]` lookup).

- [ ] **Step 6: Commit**

```bash
git add src/app/candidates/page.tsx
git commit -m "refactor: candidates grid uses shared fitMeta instead of local FIT table"
```

---

### Task 3: Consolidate `candidates/[id]/page.tsx` onto `fit.ts`

**Files:**
- Modify: `src/app/candidates/[id]/page.tsx`

**Interfaces:**
- Consumes: `fitMeta` from Task 1 (`../../../components/fit`)

- [ ] **Step 1: Remove the local `FIT` table, import `fitMeta`**

Replace lines 1–24 (imports through the `FIT` const):

```ts
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getCandidateProfile } from '../../../services/ats-views';
import { listCandidateConsents } from '../../../services/comms-log';

export const dynamic = 'force-dynamic';

const CONSENT_TONE: Record<string, string> = {
  granted: 'consent-granted',
  revoked: 'consent-revoked',
  unknown: 'consent-unknown',
};

const STAGE_LABEL: Record<string, string> = {
  sourced: 'Sourced', screened: 'Screened', submitted: 'Submitted',
  interviewing: 'Interviewing', offer: 'Offer', placed: 'Placed', rejected: 'Rejected',
};

const FIT: Record<string, { label: string; tone: string }> = {
  yes: { label: 'Strong fit', tone: 'fit-good' },
  borderline: { label: 'Borderline', tone: 'fit-warn' },
  no: { label: 'Poor fit', tone: 'fit-bad' },
};
```

with:

```ts
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '../../../lib/auth';
import { getCandidateProfile } from '../../../services/ats-views';
import { listCandidateConsents } from '../../../services/comms-log';
import { fitMeta } from '../../../components/fit';

export const dynamic = 'force-dynamic';

const CONSENT_TONE: Record<string, string> = {
  granted: 'consent-granted',
  revoked: 'consent-revoked',
  unknown: 'consent-unknown',
};

const STAGE_LABEL: Record<string, string> = {
  sourced: 'Sourced', screened: 'Screened', submitted: 'Submitted',
  interviewing: 'Interviewing', offer: 'Offer', placed: 'Placed', rejected: 'Rejected',
};
```

- [ ] **Step 2: Swap both `FIT[...]` lookups for `fitMeta(...)`**

Replace:

```ts
  const fit = latest?.fit_rating ? FIT[latest.fit_rating] : null;
```

with:

```ts
  const fit = fitMeta(latest?.fit_rating);
```

Replace:

```ts
              const f = FIT[s.fit_rating];
```

with:

```ts
              const f = fitMeta(s.fit_rating);
```

- [ ] **Step 3: Verify with build + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. Behavior-preserving refactor — no route test exists today for this page.

- [ ] **Step 4: Commit**

```bash
git add src/app/candidates/[id]/page.tsx
git commit -m "refactor: candidate detail page uses shared fitMeta instead of local FIT table"
```

---

### Task 4: `listCandidates` job-order filter

**Files:**
- Modify: `src/services/ats-views.ts:1,123-148`
- Test: `src/services/ats-views.test.ts`

**Interfaces:**
- Produces: `listCandidates(orgId: string, opts?: { jobOrderId?: string })` — unfiltered call
  (no `opts` or `opts.jobOrderId` omitted) is unchanged from today; with `opts.jobOrderId` set,
  only candidates with an `applications` row against that job order are returned.

- [ ] **Step 1: Write the failing tests**

In `src/services/ats-views.test.ts`, add these imports at the top (after the existing ones):

```ts
import postgres from 'postgres';
import { getEnv } from '../lib/env';
```

Add this new `describe` block at the end of the file, after the existing `listCandidates /
listClients` block:

```ts
describe('listCandidates job-order filter', () => {
  it('returns only candidates with an application against the given job order', async () => {
    const filtered = await listCandidates(f.orgId, { jobOrderId: f.jobId });
    expect(filtered.map((c) => c.id).sort()).toEqual([f.cand1, f.cand2].sort());
  });

  it('excludes a candidate with no application to the filtered job order', async () => {
    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const [cand3] = await sql`
      insert into candidates (org_id, full_name, email)
      values (${f.orgId}, ${'Cand C ' + f.tag}, ${f.tag + '-c@example.com'}) returning id`;
    await sql.end();

    const filtered = await listCandidates(f.orgId, { jobOrderId: f.jobId });
    expect(filtered.map((c) => c.id)).not.toContain(cand3.id as string);

    const unfiltered = await listCandidates(f.orgId);
    expect(unfiltered.map((c) => c.id)).toContain(cand3.id as string);
  });

  it('returns an empty array when the job order has no candidates', async () => {
    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const [otherJob] = await sql`
      insert into job_orders (org_id, client_id, title, kind)
      values (${f.orgId}, ${f.clientId}, ${'Empty Job ' + f.tag}, 'contract') returning id`;
    await sql.end();

    expect(await listCandidates(f.orgId, { jobOrderId: otherJob.id as string })).toEqual([]);
  });

  it('an unfiltered call is unchanged from today', async () => {
    const ids = (await listCandidates(f.orgId)).map((c) => c.id);
    expect(ids).toContain(f.cand1);
    expect(ids).toContain(f.cand2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/ats-views.test.ts -t "job-order filter"`
Expected: FAIL — `listCandidates` doesn't accept a second argument yet, so the filtered call
returns the same (unfiltered) set as `listCandidates(f.orgId)`, and the "returns only candidates
with an application against the given job order" assertion fails once a candidate outside the job
order exists. (The "empty array" and "excludes" cases will fail because filtering isn't
implemented at all.)

- [ ] **Step 3: Implement the filter**

In `src/services/ats-views.ts`, replace the import line:

```ts
import { and, count, desc, eq } from 'drizzle-orm';
```

with:

```ts
import { and, count, desc, eq, inArray } from 'drizzle-orm';
```

Replace the `listCandidates` function (current lines 123–148):

```ts
export async function listCandidates(orgId: string) {
  const rows = await db
    .select()
    .from(candidates)
    .where(eq(candidates.org_id, orgId))
    .orderBy(desc(candidates.created_at));

  // Attach each candidate's latest fit score (most-recent scores row wins) so the
  // card grid can show a fit rating + ring without a per-card query. Org-scoped.
  const scoreRows = await db
    .select({
      candidate_id: scores.candidate_id,
      fit_rating: scores.fit_rating,
      weighted_score: scores.weighted_score,
      created_at: scores.created_at,
    })
    .from(scores)
    .where(eq(scores.org_id, orgId))
    .orderBy(desc(scores.created_at));
  const latestScore = new Map<string, (typeof scoreRows)[number]>();
  for (const s of scoreRows) {
    if (!latestScore.has(s.candidate_id)) latestScore.set(s.candidate_id, s);
  }

  return rows.map((c) => ({ ...c, score: latestScore.get(c.id) ?? null }));
}
```

with:

```ts
export async function listCandidates(orgId: string, opts?: { jobOrderId?: string }) {
  const filters = [eq(candidates.org_id, orgId)];
  if (opts?.jobOrderId) {
    const apps = await db
      .select({ candidate_id: applications.candidate_id })
      .from(applications)
      .where(and(eq(applications.org_id, orgId), eq(applications.job_order_id, opts.jobOrderId)));
    if (apps.length === 0) return [];
    filters.push(inArray(candidates.id, apps.map((a) => a.candidate_id)));
  }

  const rows = await db
    .select()
    .from(candidates)
    .where(and(...filters))
    .orderBy(desc(candidates.created_at));

  // Attach each candidate's latest fit score (most-recent scores row wins) so the
  // card grid can show a fit rating + ring without a per-card query. Org-scoped.
  const scoreRows = await db
    .select({
      candidate_id: scores.candidate_id,
      fit_rating: scores.fit_rating,
      weighted_score: scores.weighted_score,
      created_at: scores.created_at,
    })
    .from(scores)
    .where(eq(scores.org_id, orgId))
    .orderBy(desc(scores.created_at));
  const latestScore = new Map<string, (typeof scoreRows)[number]>();
  for (const s of scoreRows) {
    if (!latestScore.has(s.candidate_id)) latestScore.set(s.candidate_id, s);
  }

  return rows.map((c) => ({ ...c, score: latestScore.get(c.id) ?? null }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/ats-views.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones — the join subquery only
runs when `opts.jobOrderId` is set, so the unfiltered path is byte-for-byte the same query as
before).

- [ ] **Step 5: Commit**

```bash
git add src/services/ats-views.ts src/services/ats-views.test.ts
git commit -m "feat: listCandidates accepts an optional job-order filter"
```

---

### Task 5: `SourcingPanel` — fit-badge / match-tier chip, drop raw distance

**Files:**
- Modify: `src/app/jobs/[id]/SourcingPanel.tsx`
- Modify: `src/app/jobs/[id]/SourcingPanel.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `fitMeta`, `matchTier` from Task 1 (`../../../components/fit`)

- [ ] **Step 1: Write the failing tests**

In `src/app/jobs/[id]/SourcingPanel.test.tsx`, replace the existing "renders the shortlist with
fit badges when done" test:

```ts
  it('renders the shortlist with fit badges when done', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'done', stats: { shortlisted: 1 }, error: null },
      shortlist: [{
        candidate_id: 'c1', full_name: 'Ada L', current_title: 'Engineer',
        distance: 0.41, fit_rating: 'yes',
      }],
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText('Ada L')).toBeInTheDocument();
    expect(screen.getByText(/strong fit/i)).toBeInTheDocument();
  });
```

with:

```ts
  it('renders the shortlist with a fit badge, no raw distance, once screened', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'done', stats: { shortlisted: 1 }, error: null },
      shortlist: [{
        candidate_id: 'c1', full_name: 'Ada L', current_title: 'Engineer',
        distance: 0.41, fit_rating: 'yes',
      }],
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText('Ada L')).toBeInTheDocument();
    expect(screen.getByText(/strong fit/i)).toBeInTheDocument();
    expect(screen.queryByText(/distance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/close match|possible match/i)).not.toBeInTheDocument();
  });

  it('shows a "Close match" chip, no raw distance, for an unscreened candidate under the threshold', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'done', stats: { shortlisted: 1 }, error: null },
      shortlist: [{
        candidate_id: 'c2', full_name: 'Ben K', current_title: 'Engineer',
        distance: 0.3, fit_rating: null,
      }],
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText(/close match/i)).toBeInTheDocument();
    expect(screen.queryByText(/distance/i)).not.toBeInTheDocument();
  });

  it('shows a "Possible match" chip for an unscreened candidate at/above the threshold', async () => {
    fetchMock.mockReturnValue(jsonRes({
      run: { id: 'r1', phase: 'done', stats: { shortlisted: 1 }, error: null },
      shortlist: [{
        candidate_id: 'c3', full_name: 'Cara M', current_title: 'Engineer',
        distance: 0.7, fit_rating: null,
      }],
    }));
    render(<SourcingPanel jobId="j1" autoStart={false} />);
    expect(await screen.findByText(/possible match/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/jobs/\[id\]/SourcingPanel.test.tsx`
Expected: FAIL — the current component still renders `distance 0.410` (so `queryByText(/distance/i)`
finds it) and never renders "Close match"/"Possible match" text.

- [ ] **Step 3: Implement the component change**

In `src/app/jobs/[id]/SourcingPanel.tsx`, replace lines 19–23 (the local `FIT` const) and add the
import:

```ts
import { isTerminalPhase, type SourcingStats } from '../../../contracts/sourcing';
import { phaseLabel } from '../../../components/sourcing-phases';
import type { ShortlistEntry } from '../../../services/sourcing-runs';

type Run = {
  id: string;
  phase: string;
  stats: SourcingStats;
  error: string | null;
};

const POLL_MS = 2500;

const FIT: Record<string, { label: string; tone: string }> = {
  yes: { label: 'Strong fit', tone: 'fit-good' },
  borderline: { label: 'Borderline', tone: 'fit-warn' },
  no: { label: 'Poor fit', tone: 'fit-bad' },
};
```

with:

```ts
import { isTerminalPhase, type SourcingStats } from '../../../contracts/sourcing';
import { phaseLabel } from '../../../components/sourcing-phases';
import type { ShortlistEntry } from '../../../services/sourcing-runs';
import { fitMeta, matchTier } from '../../../components/fit';

type Run = {
  id: string;
  phase: string;
  stats: SourcingStats;
  error: string | null;
};

const POLL_MS = 2500;
```

Replace the shortlist rendering block:

```tsx
      {shortlist !== null && shortlist.length > 0 && (
        <ol className="shortlist">
          {shortlist.map((s) => {
            const f = s.fit_rating ? FIT[s.fit_rating] : null;
            return (
              <li key={s.candidate_id} className="card shortlist-card">
                <Link href={`/candidates/${s.candidate_id}`} className="shortlist-name">
                  {s.full_name}
                </Link>
                {s.current_title && <span className="shortlist-title">{s.current_title}</span>}
                <span className="chip tnum">distance {Number(s.distance).toFixed(3)}</span>
                {f && <span className={`fit-badge ${f.tone}`}>{f.label}</span>}
              </li>
            );
          })}
        </ol>
      )}
```

with:

```tsx
      {shortlist !== null && shortlist.length > 0 && (
        <ol className="shortlist">
          {shortlist.map((s) => {
            const f = fitMeta(s.fit_rating);
            const match = f ? null : matchTier(s.distance);
            return (
              <li key={s.candidate_id} className="card shortlist-card">
                <Link href={`/candidates/${s.candidate_id}`} className="shortlist-name">
                  {s.full_name}
                </Link>
                {s.current_title && <span className="shortlist-title">{s.current_title}</span>}
                {f && <span className={`fit-badge ${f.tone}`}>{f.label}</span>}
                {match && <span className={`match-chip ${match.tone}`}>{match.label}</span>}
              </li>
            );
          })}
        </ol>
      )}
```

- [ ] **Step 4: Add the match-chip CSS**

In `src/app/globals.css`, immediately after the `.fit-badge` block (the four lines starting
`/* Fit badge — tone tracks...`), add:

```css
/* Match chip — the pre-screening counterpart to .fit-badge: a plain-English read on embedding
   similarity before a real fit_rating exists. Quieter than .fit-badge on purpose (reuses .chip's
   weight) since it's a similarity signal, not a graded judgment, and must not visually compete
   with a real fit-badge once screening produces one. */
.match-chip { display: inline-flex; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: var(--r-pill); background: var(--ink-100); color: var(--ink-600); }
.match-close { color: var(--accent-ink); background: var(--accent-soft); }
.match-possible { color: var(--ink-600); background: var(--ink-100); }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/jobs/\[id\]/SourcingPanel.test.tsx`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add src/app/jobs/\[id\]/SourcingPanel.tsx src/app/jobs/\[id\]/SourcingPanel.test.tsx src/app/globals.css
git commit -m "feat: shortlist shows fit-badge or match-tier chip, never raw distance"
```

---

### Task 6: `JobOrderFilter` client component

**Files:**
- Create: `src/components/JobOrderFilter.tsx`
- Test: `src/components/JobOrderFilter.test.tsx`

**Interfaces:**
- Produces: `JobOrderFilter({ jobOrders: Array<{ id: string; title: string }>, selected: string | null })`
  — a `'use client'` component. On change, calls `useRouter().push('/candidates?job=<id>')`, or
  `push('/candidates')` when "All job orders" is chosen.

- [ ] **Step 1: Write the failing test**

Create `src/components/JobOrderFilter.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobOrderFilter } from './JobOrderFilter';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe('JobOrderFilter', () => {
  it('navigates to /candidates?job=<id> when a job order is selected', async () => {
    render(
      <JobOrderFilter
        jobOrders={[{ id: 'j1', title: 'Job One' }, { id: 'j2', title: 'Job Two' }]}
        selected={null}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/filter by job order/i), 'j1');
    expect(pushMock).toHaveBeenCalledWith('/candidates?job=j1');
  });

  it('navigates back to /candidates with no filter when "All job orders" is selected', async () => {
    render(
      <JobOrderFilter
        jobOrders={[{ id: 'j1', title: 'Job One' }]}
        selected="j1"
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/filter by job order/i), '');
    expect(pushMock).toHaveBeenCalledWith('/candidates');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/JobOrderFilter.test.tsx`
Expected: FAIL — `Cannot find module './JobOrderFilter'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/components/JobOrderFilter.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';

/** Narrows the Candidates grid to one job order via the ?job= URL param, so the page stays
 * server-rendered — this is the only client-side piece. */
export function JobOrderFilter({
  jobOrders,
  selected,
}: {
  jobOrders: Array<{ id: string; title: string }>;
  selected: string | null;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Filter by job order"
      className="job-filter"
      value={selected ?? ''}
      onChange={(e) => {
        const value = e.target.value;
        router.push(value ? `/candidates?job=${value}` : '/candidates');
      }}
    >
      <option value="">All job orders</option>
      {jobOrders.map((j) => (
        <option key={j.id} value={j.id}>{j.title}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/JobOrderFilter.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/JobOrderFilter.tsx src/components/JobOrderFilter.test.tsx
git commit -m "feat: add JobOrderFilter client component"
```

---

### Task 7: Wire the filter into the Candidates page

**Files:**
- Modify: `src/app/candidates/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `JobOrderFilter` from Task 6, `listJobOrders` (already exported from
  `../../services/ats-views`), the `jobOrderId` option added to `listCandidates` in Task 4.

- [ ] **Step 1: Add the searchParams-driven filter to the page**

In `src/app/candidates/page.tsx`, replace the import line and function signature:

```ts
import Link from 'next/link';
import { auth } from '../../lib/auth';
import { listCandidates } from '../../services/ats-views';
import { fitMeta } from '../../components/fit';

export const dynamic = 'force-dynamic';
```

with:

```ts
import Link from 'next/link';
import { auth } from '../../lib/auth';
import { listCandidates, listJobOrders } from '../../services/ats-views';
import { fitMeta } from '../../components/fit';
import { JobOrderFilter } from '../../components/JobOrderFilter';

export const dynamic = 'force-dynamic';
```

Replace the component body's opening (from `export default async function CandidatesPage()`
through the `page-lede` paragraph's closing `</p>`):

```tsx
export default async function CandidatesPage() {
  const session = await auth();
  if (!session) return null;
  const rows = await listCandidates(session.user.org_id);

  return (
    <main>
      <div className="page-head">
        <span className="eyebrow">Candidates</span>
        <h1>Candidates</h1>
        <p className="page-lede">
          Everyone the agents have sourced, screened, or advanced — across all job orders.
        </p>
      </div>
```

with:

```tsx
export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const session = await auth();
  if (!session) return null;
  const { job } = await searchParams;
  const [rows, jobOrders] = await Promise.all([
    listCandidates(session.user.org_id, job ? { jobOrderId: job } : undefined),
    listJobOrders(session.user.org_id),
  ]);

  return (
    <main>
      <div className="page-head">
        <span className="eyebrow">Candidates</span>
        <h1>Candidates</h1>
        <p className="page-lede">
          Everyone the agents have sourced, screened, or advanced — across all job orders.
        </p>
        <JobOrderFilter
          jobOrders={jobOrders.map((j) => ({ id: j.id, title: j.title }))}
          selected={job ?? null}
        />
      </div>
```

- [ ] **Step 2: Add filter CSS**

In `src/app/globals.css`, immediately after the `.jd-source-form input:focus` rule (the JobDiva
job-number import form block), add:

```css
/* Candidates-grid job-order filter — same input treatment as the JobDiva import field above. */
.job-filter { margin-top: 14px; padding: 10px 12px; border: 1px solid var(--ink-200); border-radius: var(--r-sm); background: var(--paper); color: var(--ink-800); font-size: 14px; font-family: inherit; }
.job-filter:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
```

- [ ] **Step 3: Verify with build + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev` (or use the already-running dev server), then in a browser:
1. Visit `/candidates` — the "All job orders" select appears under the page lede, grid shows every
   candidate (unchanged from before this task).
2. Pick a job order from the dropdown — URL becomes `/candidates?job=<id>`, grid narrows to only
   candidates with a pipeline against that job order.
3. Pick "All job orders" again — URL returns to `/candidates`, grid shows everyone again.

- [ ] **Step 5: Commit**

```bash
git add src/app/candidates/page.tsx src/app/globals.css
git commit -m "feat: Candidates grid filters by job order via JobOrderFilter"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — every suite green, including all tests touched or added in Tasks 1–7.

- [ ] **Step 2: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: build succeeds (catches any server/client component boundary issues Next.js's type
checking might have missed, e.g. a stray `'use client'` omission).

- [ ] **Step 4: Confirm no work is left uncommitted**

Run: `git status`
Expected: clean working tree — every task in this plan ended with its own commit.
