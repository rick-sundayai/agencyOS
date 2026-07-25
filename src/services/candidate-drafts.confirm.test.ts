import { describe, it, expect, beforeAll, vi } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';
import { createFixtureOrg } from '../test/fixtures';
import { confirmCandidateDraft, permanentKey } from './candidate-drafts';
import type { ObjectStore } from './storage';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
beforeAll(async () => { orgId = await createFixtureOrg(); });

function storeWithText(text: string): ObjectStore & { moves: Array<[string, string]> } {
  const moves: Array<[string, string]> = [];
  return {
    moves,
    async put() {},
    async getText() { return text; },
    async move(f, t) { moves.push([f, t]); },
    async signedReadUrl() { return ''; },
  };
}
const vec = () => { const v = new Array(3072).fill(0); v[0] = 1; return v; };

describe('confirmCandidateDraft', () => {
  it('ingests, promotes the file, embeds, and marks embedded', async () => {
    const store = storeWithText('Jane Doe resume, React and Node.');
    const embed = vi.fn(async () => vec());
    const r = await confirmCandidateDraft(orgId, 'draft-a',
      { full_name: 'Jane Doe', email: `jane-${Date.now()}@x.com`, phone: null,
        current_title: 'Engineer', location: 'NYC' }, { store, embed });

    expect(r.embedding_status).toBe('embedded');
    expect(embed).toHaveBeenCalled();
    expect(store.moves[0]).toEqual([
      `staging/${orgId}/draft-a`, permanentKey(orgId, r.candidate_id, r.document_id!)]);
    const [doc] = await sql`
      select storage_key, embedding_status from candidate_documents where id = ${r.document_id}`;
    expect(doc.storage_key).toBe(permanentKey(orgId, r.candidate_id, r.document_id!));
    expect(doc.embedding_status).toBe('embedded');
    const [emb] = await sql`
      select count(*)::int as n from embeddings where subject_id = ${r.document_id}`;
    expect(emb.n).toBeGreaterThan(0);
  });

  it('keeps the candidate but marks failed when embedding throws', async () => {
    const store = storeWithText('Bob resume text here.');
    const embed = vi.fn(async () => { throw new Error('embed down'); });
    const r = await confirmCandidateDraft(orgId, 'draft-b',
      { full_name: 'Bob Roe', email: `bob-${Date.now()}@x.com`, phone: null,
        current_title: null, location: null }, { store, embed });

    expect(r.candidate_id).toBeTruthy();
    expect(r.embedding_status).toBe('failed');
    const [doc] = await sql`
      select embedding_status from candidate_documents where id = ${r.document_id}`;
    expect(doc.embedding_status).toBe('failed');
  });
});
