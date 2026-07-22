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
