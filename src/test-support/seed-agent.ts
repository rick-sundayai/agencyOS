import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, orgs } from '../db/schema';
import { hashApiKey } from '../lib/agent-auth';

/** Inserts a fresh agent with a random plaintext key for tests. Not for production use. */
export async function seedTestAgent(): Promise<{ orgId: string; key: string; name: string }> {
  const [org] = await db.select().from(orgs).where(eq(orgs.name, 'Sunday AI Work'));
  const name = `test-agent-${randomUUID()}`;
  const key = randomUUID();
  await db.insert(agents).values({ org_id: org.id, name, api_key_hash: hashApiKey(key) });
  return { orgId: org.id, key, name };
}
