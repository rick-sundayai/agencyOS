import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { proposeDecision, listQueue } from '../../../../services/decision-store';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    const decision = await proposeDecision({ ...body, org_id: auth.org_id });
    return Response.json({ decision }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    return Response.json({ queue: await listQueue(auth.org_id) });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
