/**
 * The Sourcing subsystem's phase vocabulary — the single source of truth every call site
 * (service, agent PATCH route, panel, schema comment) derives from, mirroring how
 * `contracts/decision.ts` owns the Decision Tier/state vocabulary.
 *
 * Display strings (labels) live apart, in a UI-side helper, the same way Tier labels live
 * in `components/tiers.ts` rather than here — this module holds vocabulary only, no
 * presentation and no read-model DTOs.
 */
import { z } from 'zod';

/**
 * The eight phases a Sourcing run moves through, in happy-path flow order. The order is
 * documentation only — nothing derives transition rules from a phase's position, because
 * the real flow is a DAG (`checking_jobdiva`/`embedding_new` are skippable, `failed` is
 * reachable from anywhere). See ADR-0008. The one progression invariant we enforce —
 * terminality — is expressed by `isTerminalPhase()`, which is order-independent.
 */
export const SOURCING_PHASES = [
  'queued', 'searching_pool', 'checking_jobdiva', 'embedding_new',
  'shortlisting', 'screening', 'done', 'failed',
] as const;

export type SourcingPhase = (typeof SOURCING_PHASES)[number];

/** The phases a run never leaves. A run in one of these is finished for good. */
export const TERMINAL_PHASES = ['done', 'failed'] as const satisfies readonly SourcingPhase[];

const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_PHASES);

/** True once a run has finished (done or failed). Accepts a raw string so it reads cleanly
 * at the DB/JSON boundary, where `phase` arrives untyped. */
export function isTerminalPhase(phase: string): boolean {
  return TERMINAL_SET.has(phase);
}

/**
 * The progress counters (and one soft error) a run accumulates in `sourcing_runs.stats`,
 * shallow-merged across phases by Postgres. Written incrementally by two producers — the
 * n8n sourcing workflow (`pool_matches`, `shortlisted`, `jobdiva_error`) and the app-side
 * JobDiva import (`jobdiva_found` / `jobdiva_new`, `embedded`, `skipped`) — and read by the
 * Sourcing panel. Every field is optional: a run only holds the counters its reached phases
 * have written. Unlike `ShortlistEntry`, this shape crosses the route/n8n seam, so it lives
 * in the contract rather than on the service.
 */
export type SourcingStats = {
  pool_matches?: number;
  jobdiva_found?: number;
  jobdiva_new?: number;
  embedded?: number;
  skipped?: number;
  shortlisted?: number;
  jobdiva_error?: string;
  /** JobDiva hits excluded at import because CandidateDetail had no usable email. */
  no_email?: number;
};

/**
 * Route-boundary validator for a `stats` patch. Checks the type of every known counter but
 * lets unknown keys pass through (`catchall`), so a new n8n-side stat never 400s the whole
 * PATCH — which would drop the phase transition riding along in the same request, silently,
 * because the workflow swallows the error non-fatally.
 */
export const SourcingStatsSchema = z.object({
  pool_matches: z.number().optional(),
  jobdiva_found: z.number().optional(),
  jobdiva_new: z.number().optional(),
  embedded: z.number().optional(),
  skipped: z.number().optional(),
  shortlisted: z.number().optional(),
  jobdiva_error: z.string().optional(),
  no_email: z.number().optional(),
}).catchall(z.unknown());

/**
 * One ranked candidate inside a `source.shortlist` Decision's payload — the sourcing search
 * result (candidate + vector distance) before screening fit is attached. The exact shape
 * `searchCandidatesByEmbedding` returns and the n8n workflow writes.
 */
export const RankedCandidateSchema = z.object({
  candidate_id: z.string(),
  full_name: z.string(),
  current_title: z.string().nullable(),
  distance: z.number(),
});

export type RankedCandidate = z.infer<typeof RankedCandidateSchema>;

/**
 * The payload an executed `source.shortlist` Decision carries: the ranked candidates and
 * their ids. Produced by the n8n sourcing workflow, consumed by `getSourcingShortlist`,
 * which parses against this instead of asserting the payload's type. Unknown top-level keys
 * pass through (`catchall`) so parsing the shortlist doesn't reject the workflow's other
 * payload fields.
 */
export const ShortlistPayloadSchema = z.object({
  candidate_ids: z.array(z.string()).default([]),
  ranked: z.array(RankedCandidateSchema).default([]),
}).catchall(z.unknown());

export type ShortlistPayload = z.infer<typeof ShortlistPayloadSchema>;
