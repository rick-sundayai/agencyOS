import { requireAgentKey } from '../../../../../lib/agent-auth';
import { getCandidateWithResume } from '../../../../../services/matching';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  try {
    const result = await getCandidateWithResume(auth.org_id, id);
    if (!result) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json(result);
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
