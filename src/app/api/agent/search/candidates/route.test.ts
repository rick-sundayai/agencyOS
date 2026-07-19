import { describe, it, expect } from 'vitest';
import { db } from '../../../../../db/client';
import { candidates, candidate_documents, embeddings } from '../../../../../db/schema';
import { seedTestAgentInFreshOrg } from '../../../../../test-support/seed-agent';
import { POST } from './route';

const VEC = new Array(3072).fill(0);

async function seedSearchableCandidate(orgId: string, fullName: string) {
  const [candidate] = await db.insert(candidates).values({ org_id: orgId, full_name: fullName }).returning();
  const [doc] = await db.insert(candidate_documents).values({
    org_id: orgId, candidate_id: candidate.id, kind: 'resume', storage_key: `test/${candidate.id}.txt`,
  }).returning();
  await db.insert(embeddings).values({
    org_id: orgId, subject_type: 'candidate_document', subject_id: doc.id,
    chunk_index: 0, content: 'test content', embedding: VEC, content_hash: 'hash',
  });
  return candidate;
}

function post(body: unknown, key: string) {
  return POST(new Request('http://test/api/agent/search/candidates', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': key },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/agent/search/candidates', () => {
  it('401s without a key', async () => {
    const res = await POST(new Request('http://test/api/agent/search/candidates', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('ignores a client-supplied org_id and searches only the authenticated agent\'s own org', async () => {
    const owner = await seedTestAgentInFreshOrg();
    const other = await seedTestAgentInFreshOrg();
    const ownCandidate = await seedSearchableCandidate(owner.orgId, 'Own Org Candidate');
    const otherCandidate = await seedSearchableCandidate(other.orgId, 'Other Org Candidate');

    const res = await post({ org_id: other.orgId, query_embedding: VEC, limit: 10 }, owner.key);
    expect(res.status).toBe(200);
    const json = await res.json();
    const ids = json.results.map((r: { candidate_id: string }) => r.candidate_id);
    expect(ids).toContain(ownCandidate.id);
    expect(ids).not.toContain(otherCandidate.id);
  });
});
