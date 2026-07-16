import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../../lib/agent-auth';
import { transitionDecision } from '../../../../../../services/decision-store';
import { DECISION_STATES } from '../../../../../../contracts/decision';

const TransitionBodySchema = z.strictObject({
  to: z.enum(DECISION_STATES),
  actor: z.string().min(1),
  error: z.string().nullable().optional(),
  outcome: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const body = TransitionBodySchema.parse(await req.json());
    const decision = await transitionDecision(id, body.to, body.actor, {
      error: body.error, outcome: body.outcome,
    });
    return Response.json({ decision });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'internal_error';
    if (msg.startsWith('Invalid transition')) return Response.json({ error: msg }, { status: 409 });
    // ADR-0003's compare-and-swap race guard — the row moved between read and write
    // (e.g. a human cancelled it the same tick the executor picked it up). Same bucket
    // as "Invalid transition" (409, not the caller's fault, not a server error) — Task 12
    // needs to tell this apart from a real 500 to keep processing the rest of its batch.
    if (msg.includes('already transitioned by another process')) {
      return Response.json({ error: msg }, { status: 409 });
    }
    if (msg.startsWith('Decision not found')) return Response.json({ error: msg }, { status: 404 });
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
