import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../client';
import { agents } from './index';
import { createFixtureOrg } from '../../test/fixtures';

let orgId: string;

beforeAll(async () => {
  orgId = await createFixtureOrg();
});

describe('agents table', () => {
  it('inserts a row scoped to an org', async () => {
    const [row] = await db.insert(agents)
      .values({ org_id: orgId, name: `agent-${randomUUID()}`, api_key_hash: randomUUID() })
      .returning();
    expect(row.org_id).toBe(orgId);
    expect(row.id).toBeTruthy();
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('rejects a duplicate api_key_hash', async () => {
    const hash = randomUUID();
    await db.insert(agents).values({ org_id: orgId, name: `agent-${randomUUID()}`, api_key_hash: hash });
    await expect(
      db.insert(agents).values({ org_id: orgId, name: `agent-${randomUUID()}`, api_key_hash: hash }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate (org_id, name) pair', async () => {
    const name = `agent-${randomUUID()}`;
    await db.insert(agents).values({ org_id: orgId, name, api_key_hash: randomUUID() });
    await expect(
      db.insert(agents).values({ org_id: orgId, name, api_key_hash: randomUUID() }),
    ).rejects.toThrow();
  });
});
