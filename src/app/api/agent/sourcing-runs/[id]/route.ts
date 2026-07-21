import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { updateSourcingRun } from '../../../../../services/sourcing-runs';

const PatchSchema = z.strictObject({
  phase: z.enum([
    'queued', 'searching_pool', 'checking_jobdiva', 'embedding_new',
    'shortlisting', 'screening', 'done', 'failed',
  ]).optional(),
  stats: z.record(z.string(), z.unknown()).optional(),
  error: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request, { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const patch = PatchSchema.parse(await req.json());
    const run = await updateSourcingRun(auth.org_id, id, patch);
    if (!run) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ run });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
