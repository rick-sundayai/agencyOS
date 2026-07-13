import { and, desc, eq, gt, or } from 'drizzle-orm';
import { db } from '../db/client';
import { decisions, autonomy_policy } from '../db/schema';
import { DecisionProposalSchema, ACTION_CLASSES, MONEY_ACTION_CLASSES, type ActionClass, type DecisionState } from '../contracts/decision';
import { canTransition } from '../contracts/transitions';

export type DecisionRow = typeof decisions.$inferSelect;

async function getPolicy(orgId: string, actionClass: ActionClass) {
  // Money action classes never graduate — clamp in code, not just seed data (ADR-0001).
  if ((MONEY_ACTION_CLASSES as readonly ActionClass[]).includes(actionClass)) {
    return { tier: '3' as const, undo_minutes: 0 };
  }
  const rows = await db.select().from(autonomy_policy)
    .where(and(eq(autonomy_policy.org_id, orgId), eq(autonomy_policy.action_class, actionClass)));
  if (rows.length > 0) return { tier: rows[0].tier, undo_minutes: rows[0].undo_minutes };
  return { tier: ACTION_CLASSES[actionClass], undo_minutes: 15 }; // contract default if unseeded
}

export async function proposeDecision(input: unknown): Promise<DecisionRow> {
  const p = DecisionProposalSchema.parse(input);
  const policy = await getPolicy(p.org_id, p.action_class);

  const autoApproved = policy.tier === '1' || policy.tier === '2';
  const undoExpiresAt = policy.tier === '2'
    ? new Date(Date.now() + policy.undo_minutes * 60_000)
    : null;

  const [row] = await db.insert(decisions).values({
    org_id: p.org_id,
    agent: p.agent,
    action_class: p.action_class,
    tier: policy.tier,
    state: autoApproved ? 'approved' : 'proposed',
    reasoning: p.reasoning,
    payload: p.payload,
    job_order_id: p.job_order_id,
    candidate_id: p.candidate_id,
    client_id: p.client_id,
    undo_expires_at: undoExpiresAt,
    approved_by: autoApproved ? 'policy' : null,
    decided_at: autoApproved ? new Date() : null,
  }).returning();
  return row;
}

export async function transitionDecision(
  id: string, to: DecisionState, actor: string,
): Promise<DecisionRow> {
  const [current] = await db.select().from(decisions).where(eq(decisions.id, id));
  if (!current) throw new Error(`Decision not found: ${id}`);
  const from = current.state as DecisionState;
  if (!canTransition(from, to)) throw new Error(`Invalid transition ${from} → ${to}`);

  const patch: Partial<typeof decisions.$inferInsert> = { state: to };
  if (to === 'approved') { patch.approved_by = actor; patch.decided_at = new Date(); }
  if (to === 'cancelled') {
    patch.cancelled_by = actor;
    patch.cancelled_at = new Date();
    // A proposed→cancelled rejection IS the decision; an approved→cancelled undo must not
    // overwrite the original policy/human approval timestamp (ADR-0002).
    if (!current.decided_at) patch.decided_at = new Date();
  }
  if (to === 'executed') { patch.executed_at = new Date(); }

  // Compare-and-swap on state: guards against a concurrent transition (e.g. Plan 1c's
  // executor and a human Undo click racing on the same row) silently overwriting each
  // other. Whichever caller loses the race gets a thrown error instead of a lost update
  // (ADR-0003).
  const [row] = await db.update(decisions).set(patch)
    .where(and(eq(decisions.id, id), eq(decisions.state, from)))
    .returning();
  if (!row) {
    throw new Error(`Decision ${id} was already transitioned by another process (expected state ${from})`);
  }
  return row;
}

export async function getDecision(id: string): Promise<DecisionRow | null> {
  const [row] = await db.select().from(decisions).where(eq(decisions.id, id));
  return row ?? null;
}

export async function listQueue(orgId: string): Promise<DecisionRow[]> {
  return db.select().from(decisions)
    .where(and(
      eq(decisions.org_id, orgId),
      or(
        eq(decisions.state, 'proposed'),
        and(eq(decisions.state, 'approved'), gt(decisions.undo_expires_at, new Date())),
      ),
    ))
    .orderBy(desc(decisions.proposed_at));
}
