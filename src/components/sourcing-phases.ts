/**
 * Sourcing phase → the operator-facing label shown while a run is in progress. Single-sourced
 * so the Sourcing panel reads the same copy in every place a phase is announced — the display
 * counterpart to the phase vocabulary in contracts/sourcing.ts, kept apart the same way
 * tierMeta() is kept apart from the Tier vocabulary. Terminal phases (done/failed) are not
 * labelled here: the panel renders their outcome, not a progress line.
 */
const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued…',
  searching_pool: 'Searching internal pool…',
  checking_jobdiva: 'Checking JobDiva…',
  embedding_new: 'Embedding new candidates…',
  shortlisting: 'Building shortlist…',
  screening: 'Handing off to screening…',
};

/** Resolve a phase to its in-progress label, falling back to the raw phase for safety. */
export function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase;
}
