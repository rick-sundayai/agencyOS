import { getEnv } from './env';

/** Shared guard for /api/agent/* routes. Returns a 401 response or null to proceed. */
export function requireAgentKey(req: Request): Response | null {
  if (req.headers.get('x-agent-api-key') !== getEnv('AGENT_API_KEY')) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
