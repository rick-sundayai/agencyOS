import { requireAgentKey } from '../../../../lib/agent-auth';
import { getConsentStatus, CHANNELS, type Channel } from '../../../../services/comms-log';

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const candidateId = url.searchParams.get('candidate_id');
  const channel = url.searchParams.get('channel') as Channel | null;
  if (!candidateId || !channel || !CHANNELS.includes(channel)) {
    return Response.json({ error: 'candidate_id, channel required' }, { status: 400 });
  }
  return Response.json({ status: await getConsentStatus(auth.org_id, candidateId, channel) });
}
