import { requireAgentKey } from '../../../../../lib/agent-auth';
import { listExecutable } from '../../../../../services/decision-store';

export async function GET(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const queue = await listExecutable({
    orgId: url.searchParams.get('org_id') ?? undefined,
    actionPrefix: url.searchParams.get('action_prefix') ?? undefined,
  });
  return Response.json({ queue });
}
