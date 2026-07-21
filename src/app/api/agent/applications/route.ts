import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { upsertSourcedApplications } from '../../../../services/applications';

const BodySchema = z.strictObject({
  job_order_id: z.uuid(),
  candidate_ids: z.array(z.uuid()),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const p = BodySchema.parse(await req.json());
    const result = await upsertSourcedApplications(auth.org_id, p.job_order_id, p.candidate_ids);
    if (!result) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'internal_error';
    if (msg.startsWith('Unknown candidate_ids')) return Response.json({ error: msg }, { status: 400 });
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
