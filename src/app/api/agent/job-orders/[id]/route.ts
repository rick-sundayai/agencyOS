import { requireAgentKey } from '../../../../../lib/agent-auth';
import { getJobOrder } from '../../../../../services/matching';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const orgId = new URL(req.url).searchParams.get('org_id');
  if (!orgId) return Response.json({ error: 'org_id required' }, { status: 400 });
  const { id } = await ctx.params;
  const job_order = await getJobOrder(orgId, id);
  if (!job_order) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ job_order });
}
