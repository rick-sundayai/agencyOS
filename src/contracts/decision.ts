import { z } from 'zod';

export const AGENTS = [
  'prospecting', 'client-account', 'sourcing', 'screening', 'engagement',
  'interview-coordination', 'placement', 'aftercare',
  'communication', 'calendar', 'data-steward', 'compliance', 'orchestrator',
] as const;
export type Agent = (typeof AGENTS)[number];

export const TIERS = ['1', '2', '3', 'risk'] as const;
export type Tier = (typeof TIERS)[number];

/** Default tier per action class. Live values live in the autonomy_policy table (trust dial). */
export const ACTION_CLASSES = {
  // Tier 1 — auto-run, reversible, internal
  'source.shortlist': '1',
  'screen.score_resume': '1',
  'data.enrich_record': '1',
  'data.dedupe_merge': '1',
  'draft.content': '1',
  'bd.add_prospect': '1',
  // Tier 2 — undo window
  'comms.candidate_outreach': '2',
  'interview.propose_slots': '2',
  'comms.reminder': '2',
  'aftercare.timesheet_nudge': '2',
  'bd.send_sequence': '2',
  'client.chase_feedback': '2',
  // Tier 3 — human approves
  'client.submit_candidate': '3',
  'screen.disqualify': '3',
  'client.message': '3',
  'placement.assemble_offer': '3',
  'bd.send_proposal': '3',
  'placement.trigger_invoice': '3',
  // Risk — surfaced, never executes
  'risk.alert': 'risk',
} as const satisfies Record<string, Tier>;

export type ActionClass = keyof typeof ACTION_CLASSES;
export const ACTION_CLASS_NAMES = Object.keys(ACTION_CLASSES) as [ActionClass, ...ActionClass[]];

/** Never graduates via trust dial — decision-store.getPolicy() clamps these to Tier 3
 *  regardless of what autonomy_policy holds. See ADR-0001. */
export const MONEY_ACTION_CLASSES = [
  'placement.assemble_offer',
  'bd.send_proposal',
  'placement.trigger_invoice',
] as const satisfies readonly ActionClass[];

/** Cockpit management roles. Deliberately not RecruiterPro's owner/admin/member +
 *  audience model — AgencyOS's greenfield split simplifies this for a single-firm start. */
export const ROLES = ['admin', 'recruiter'] as const;
export type Role = (typeof ROLES)[number];

/** Which tiers each role may approve/cancel. Expressed in terms of Tier — the same axis
 *  the rest of the system already uses for "how much oversight" — rather than a bespoke
 *  isAdmin flag, so it composes with autonomy_policy and can grow into a per-org,
 *  DB-backed table later without changing shape (ADR-0004). */
export const ROLE_ACTIONABLE_TIERS: Record<Role, readonly Tier[]> = {
  admin: ['1', '2', '3', 'risk'],
  recruiter: ['1', '2'],
};

export function canActOnTier(role: Role, tier: Tier): boolean {
  return ROLE_ACTIONABLE_TIERS[role].includes(tier);
}

export const DECISION_STATES = [
  'proposed', 'approved', 'executing', 'executed', 'failed', 'cancelled', 'undone',
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const ReasoningSchema = z.object({
  summary: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  model: z.string().min(1),
  prompt_version: z.string().min(1),
});
export type Reasoning = z.infer<typeof ReasoningSchema>;

/** What an agent is allowed to write. Tier and state are assigned by the decision store. */
export const DecisionProposalSchema = z.strictObject({
  org_id: z.uuid(),
  agent: z.enum(AGENTS),
  action_class: z.enum(ACTION_CLASS_NAMES),
  reasoning: ReasoningSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  job_order_id: z.uuid().nullable().default(null),
  candidate_id: z.uuid().nullable().default(null),
  client_id: z.uuid().nullable().default(null),
});
export type DecisionProposal = z.infer<typeof DecisionProposalSchema>;
