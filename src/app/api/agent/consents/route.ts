import { requireAgentKey } from '../../../../lib/agent-auth';
import { getConsentStatus, CHANNELS, type Channel } from '../../../../services/comms-log';

export async function GET(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const orgId = url.searchParams.get('org_id');
  const candidateId = url.searchParams.get('candidate_id');
  const channel = url.searchParams.get('channel') as Channel | null;
  if (!orgId || !candidateId || !channel || !CHANNELS.includes(channel)) {
    return Response.json({ error: 'org_id, candidate_id, channel required' }, { status: 400 });
  }
  return Response.json({ status: await getConsentStatus(orgId, candidateId, channel) });
}
