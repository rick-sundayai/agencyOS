/**
 * Tier label + badge tone, single-sourced so a Decision's tier reads the same everywhere
 * it appears (queue card, Drawer). "Color is the alarm": Auto is the calmest (neutral ink),
 * Risk the loudest (bad); Undo-window reads accent, Needs-approval reads warn.
 */
// Not exported: the lookup table is an implementation detail behind tierMeta() below,
// which is the only interface callers need. (Previously exported as `TIERS`, colliding
// with the unrelated valid-literal `TIERS` in contracts/decision.ts — nothing outside
// this file ever imported the raw table, only tierMeta, so dropping the export removes
// the collision instead of just renaming it away.)
const TIER_DISPLAY: Record<string, { label: string; tone: string }> = {
  '1': { label: 'Auto', tone: 'tbadge-auto' },
  '2': { label: 'Undo window', tone: 'tbadge-undo' },
  '3': { label: 'Needs approval', tone: 'tbadge-approval' },
  risk: { label: 'Risk', tone: 'tbadge-risk' },
};

/** Resolve a tier to its label + tone, with a shared fallback for unknown tiers. */
export function tierMeta(tier: string): { label: string; tone: string } {
  return TIER_DISPLAY[tier] ?? { label: tier, tone: 'tbadge-approval' };
}
