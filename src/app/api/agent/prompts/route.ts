import { requireAgentKey } from '../../../../lib/agent-auth';
import { getActivePrompt } from '../../../../services/comms-log';

export async function GET(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const orgId = url.searchParams.get('org_id');
  const agent = url.searchParams.get('agent');
  const name = url.searchParams.get('name');
  if (!orgId || !agent || !name) {
    return Response.json({ error: 'org_id, agent, name required' }, { status: 400 });
  }
  const prompt = await getActivePrompt(orgId, agent, name);
  if (!prompt) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ prompt });
}
