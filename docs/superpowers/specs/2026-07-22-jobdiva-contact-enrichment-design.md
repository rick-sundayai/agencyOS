# JobDiva contact enrichment + no-email exclusion — Design

**Date:** 2026-07-22
**Status:** Approved (brainstormed with Rick)

## Goal

JobDiva's `JobAgentSearch` returns no contact fields, so every JobDiva-sourced
candidate lands with `email: null` — screening then dead-ends each "yes" score in a
`risk.alert` ("scored X% but has no email on file") and the outreach path
(draft → comms decision → compliance gates → Mailpit) is unreachable. Fix: enrich
email/phone from JobDiva's `/apiv2/bi/CandidateDetail` during import, and **exclude
candidates with no email in JobDiva from import entirely** (Rick's policy decision).

## Decisions made

- **Exclusion scope: import-only.** No-email hits are skipped at import (no candidate
  row, no resume fetch, no embedding). Existing pool rows are untouched: the next
  time a search returns an already-imported candidate, `ingestCandidate`'s merge
  (`email: existing.email ?? p.email`) backfills their email. Truly email-less
  stragglers already in the pool remain, and screening's `risk.alert` stays as the
  safety net for them. Shortlist-level filtering and purging existing rows were
  considered and rejected.
- **Enrichment lives in the import service, not the client** (Approach A).
  `importCandidatesForJob` already owns the per-hit decisions (dedupe, resume cap);
  the client stays a dumb read surface.
- **Enrich before the resume fetch**, so exclusion also skips the most expensive
  JobDiva call.
- Endpoint per Rick: `/apiv2/bi/CandidateDetail` (resume chain already uses
  `/apiv2/bi/CandidateResumesDetail` → `ResumesTextDetail`, unchanged).

## Changes

### Client — `src/services/jobdiva.ts`

New method on `JobDivaClient`:

```ts
getCandidateContact(jobdivaCandidateId: string): Promise<{ email: string | null; phone: string | null }>
```

- Wraps `/apiv2/bi/CandidateDetail` using the established BI conventions (by-ID
  param, `{data:[...]}` or bare-array envelope via `biRows()`, ALL-CAPS fields).
- **Field names must be live-verified in pre-flight before being trusted** — the
  exact keys (e.g. `EMAIL` vs `EMAILADDRESS`) are unknown until the smoke script
  prints them. No speculative multi-key fallbacks (established posture).
- Read-only, like every other client call. No new namespaces.

### Import — `src/services/jobdiva-import.ts`

Per-hit order becomes: **contact lookup → exclusion check → resume fetch → ingest →
embed.**

- No usable email ⇒ skip the hit entirely; count it in a new stat.
- "Usable" = present after trimming AND passes the existing `z.email()` validation
  (a malformed address counts as no-email: excluded, not crashed).
- Contact merged into the existing `ingestCandidate` input (`email`, `phone`) — no
  ingest changes needed; backfill of existing rows comes free from its merge logic.
- A failed `CandidateDetail` call falls into the existing per-candidate try/catch:
  that candidate is skipped (`skipped++`), the batch survives.
- `RESUME_FETCH_CAP` (25) unchanged; enrichment calls are 1-per-hit and not capped
  separately (hits are already bounded by `JobAgentSearch`'s result size).

### Stats — `src/contracts/sourcing.ts`

One new optional field on the typed `SourcingStats`: `no_email` (count of hits
excluded for missing/invalid email), written to `sourcing_runs.stats` alongside
`jobdiva_found`/`jobdiva_new`. No UI changes.

### Smoke script — `scripts/jobdiva-smoke.ts`

Extend to call `getCandidateContact` for the first search hit and print the raw
response's **field names** plus whether an email is present — email/phone **values
redacted** (candidate PII).

## Testing

- Unit tests at the import seam (mocked client): no-email hit excluded before any
  resume fetch; enriched hit ingested with email+phone; malformed email treated as
  no-email; enrichment failure → skipped, batch continues; already-known candidate
  gets email backfilled.
- Client unit test pins the live-verified `CandidateDetail` contract (envelope +
  exact field names) once pre-flight confirms them.

## Pre-flight & acceptance (live)

1. Pre-flight: `npx tsx scripts/jobdiva-smoke.ts 23-00053` prints the
   `CandidateDetail` field names for the first hit; client field mapping is written
   against what production actually returns.
2. Acceptance — the payoff run: re-source `23-00053` from the UI.
   - If JobDiva has an email for the matched candidate: email backfilled on their
     existing row; screening drafts outreach instead of a `risk.alert`; a comms
     decision appears in the Cockpit; the drafted email lands in **Mailpit** (nothing
     external).
   - If JobDiva has no email for them: the `risk.alert` correctly persists; verify
     the exclusion path (`no_email` stat > 0, no new row) with a different job
     number chosen by Rick.

## Out of scope

- Shortlist-level email filtering; purging existing no-email rows.
- Phone-only outreach channels.
- Decision-history UI (separate work, logged 2026-07-22).
- Staging-stamp verification (follows the local pass).
