import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { checkCompliance } from '../../../../../services/compliance';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    return Response.json(await checkCompliance(await req.json()));
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
