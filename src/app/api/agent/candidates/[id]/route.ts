import { requireAgentKey } from '../../../../../lib/agent-auth';
import { getCandidateWithResume } from '../../../../../services/matching';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const orgId = new URL(req.url).searchParams.get('org_id');
  if (!orgId) return Response.json({ error: 'org_id required' }, { status: 400 });
  const { id } = await ctx.params;
  try {
    const result = await getCandidateWithResume(orgId, id);
    if (!result) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
