import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { insertAgentRun } from '../../../../services/agent-runs';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const run = await insertAgentRun(await req.json());
    return Response.json({ run }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
