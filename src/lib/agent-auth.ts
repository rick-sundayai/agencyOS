import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agents } from '../db/schema';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export type AgentIdentity = { id: string; name: string; org_id: string };

/**
 * Shared guard for /api/agent/* routes. Resolves the caller's identity from the
 * x-agent-api-key header, hashed and looked up against the agents table — never
 * trust a client-supplied actor/agent name (see ADR-0005). Returns a 401 Response
 * to return as-is, or the resolved AgentIdentity to proceed with.
 */
export async function requireAgentKey(req: Request): Promise<Response | AgentIdentity> {
  const key = req.headers.get('x-agent-api-key');
  if (!key) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const [row] = await db.select().from(agents).where(eq(agents.api_key_hash, hashApiKey(key)));
  if (!row) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return { id: row.id, name: row.name, org_id: row.org_id };
}
