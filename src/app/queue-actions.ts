'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '../lib/auth';
import { canActOnTier, type Tier } from '../contracts/decision';
import { getCurrentRole } from '../lib/credentials';
import { transitionDecision, getDecision, type DecisionRow } from '../services/decision-store';

// Checks the session AND that the role may act on this decision's actual tier (ADR-0004) —
// not the tier the client claims, the one currently on the row. Role comes from a fresh DB
// read (getCurrentRole), not session.user.role: the JWT claim is cached at login and can be
// stale for the session's whole lifetime (next-auth default maxAge is 30 days) — a role
// revoked in the database must block the very next action, not wait for the next login.
//
// Also checks the decision's org_id against the session's org (ADR-0007) — same "not found"
// message as a genuinely missing decision, so a cross-org session can't distinguish the two.
async function requireCanAct(id: string): Promise<{ userId: string; orgId: string }> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  const decision = await getDecision(id);
  if (!decision) throw new Error(`Decision not found: ${id}`);
  if (decision.org_id !== session.user.org_id) throw new Error(`Decision not found: ${id}`);
  const role = await getCurrentRole(session.user.id);
  // decisions.tier is a plain text column (no DB enum) — cast to the contract's literal union,
  // same convention used for `state` in decision-store.ts (`current.state as DecisionState`).
  if (!role || !canActOnTier(role, decision.tier as Tier)) {
    throw new Error('Forbidden — your role cannot act on this tier.');
  }
  return { userId: session.user.id, orgId: session.user.org_id };
}

// transitionDecision throws this when it loses the compare-and-swap race on decisions.state
// (ADR-0003) — e.g. a human clicks Undo the same moment Plan 1c's executor picks the
// decision up. Surface a friendly message instead of the raw "already transitioned" error.
async function transitionOrFriendlyError(
  id: string, to: 'approved' | 'cancelled', actor: string, orgId: string,
): Promise<DecisionRow> {
  try {
    return await transitionDecision(id, to, actor, orgId);
  } catch (err) {
    if (err instanceof Error && err.message.includes('already transitioned by another process')) {
      throw new Error('This decision was already handled — refresh the queue.');
    }
    throw err;
  }
}

export async function approveDecisionAction(id: string): Promise<DecisionRow> {
  const { userId, orgId } = await requireCanAct(id);
  const row = await transitionOrFriendlyError(id, 'approved', userId, orgId);
  revalidatePath('/');
  return row;
}

export async function cancelDecisionAction(id: string): Promise<DecisionRow> {
  const { userId, orgId } = await requireCanAct(id);
  const row = await transitionOrFriendlyError(id, 'cancelled', userId, orgId);
  revalidatePath('/');
  return row;
}
