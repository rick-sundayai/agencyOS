import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { insertAgentRun } from '../../../../services/agent-runs';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    const run = await insertAgentRun({ ...body, org_id: auth.org_id });
    return Response.json({ run }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
