/**
 * The Sourcing subsystem's phase vocabulary — the single source of truth every call site
 * (service, agent PATCH route, panel, schema comment) derives from, mirroring how
 * `contracts/decision.ts` owns the Decision Tier/state vocabulary.
 *
 * Display strings (labels) live apart, in a UI-side helper, the same way Tier labels live
 * in `components/tiers.ts` rather than here — this module holds vocabulary only, no
 * presentation and no read-model DTOs.
 */

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
