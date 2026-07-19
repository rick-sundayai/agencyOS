import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { checkCompliance } from '../../../../../services/compliance';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    return Response.json(await checkCompliance({ ...body, org_id: auth.org_id }));
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
