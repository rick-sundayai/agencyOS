import { randomUUID } from 'node:crypto';
import { db } from '../db/client';
import { agents, orgs } from '../db/schema';
import { hashApiKey } from '../lib/agent-auth';

/**
 * Inserts a fresh agent scoped to its own brand-new, isolated org. Not for production
 * use. Never anchors to a seeded org: fixtures the caller creates under orgId must not
 * be able to land in shared data, even if run against the wrong database.
 */
export async function seedTestAgent(): Promise<{ orgId: string; key: string; name: string }> {
  const [org] = await db.insert(orgs).values({ name: `test-org-${randomUUID()}` }).returning();
  const name = `test-agent-${randomUUID()}`;
  const key = randomUUID();
  await db.insert(agents).values({ org_id: org.id, name, api_key_hash: hashApiKey(key) });
  return { orgId: org.id, key, name };
}

/**
 * Same as seedTestAgent; kept as a named entry point for org-scoping regression tests
 * that need two distinct orgs — e.g. proving a route ignores a client-supplied org_id
 * and uses the authenticated agent's own org.
 */
export async function seedTestAgentInFreshOrg(): Promise<{ orgId: string; key: string; name: string }> {
  return seedTestAgent();
}
