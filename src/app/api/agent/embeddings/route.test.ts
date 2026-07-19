import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { embeddings } from '../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../test-support/seed-agent';
import { POST } from './route';

const VEC = new Array(3072).fill(0);

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/embeddings', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/embeddings', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and writes under the authenticated agent\'s own org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const subjectId = randomUUID();

    const res = await post({
      org_id: other.orgId, subject_type: 'job_order', subject_id: subjectId,
      chunks: [{ chunk_index: 0, content: 'text', embedding: VEC, content_hash: 'hash' }],
    }, owner.key);
    expect(res.status).toBe(201);

    const rows = await db.select().from(embeddings).where(
      and(eq(embeddings.subject_id, subjectId), eq(embeddings.org_id, owner.orgId)),
    );
    expect(rows).toHaveLength(1);
  });
});
