import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { proposeDecision, listQueue } from '../../../../services/decision-store';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    const decision = await proposeDecision(await req.json());
    return Response.json({ decision }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const orgId = new URL(req.url).searchParams.get('org_id');
  if (!orgId) return Response.json({ error: 'org_id required' }, { status: 400 });
  try {
    return Response.json({ queue: await listQueue(orgId) });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
