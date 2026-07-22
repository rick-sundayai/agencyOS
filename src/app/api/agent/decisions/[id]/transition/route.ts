import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../../lib/agent-auth';
import {
  transitionDecision, DecisionNotFoundError, InvalidTransitionError, ConcurrentTransitionError,
} from '../../../../../../services/decision-store';
import { DECISION_STATES } from '../../../../../../contracts/decision';

const TransitionBodySchema = z.strictObject({
  to: z.enum(DECISION_STATES),
  error: z.string().nullable().optional(),
  outcome: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  try {
    const body = TransitionBodySchema.parse(await req.json());
    const decision = await transitionDecision(id, body.to, auth.name, auth.org_id, {
      error: body.error, outcome: body.outcome,
    });
    return Response.json({ decision });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    if (err instanceof InvalidTransitionError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    // The compare-and-swap race guard — the row moved between read and write (e.g. a human
    // cancelled it the same tick the executor picked it up). Same bucket as InvalidTransition
    // (409, not the caller's fault, not a server error) — Task 12 needs to tell this apart
    // from a real 500 to keep processing the rest of its batch.
    if (err instanceof ConcurrentTransitionError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof DecisionNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
