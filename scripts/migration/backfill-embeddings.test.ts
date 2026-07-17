import { describe, it, expect, beforeAll } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../../src/lib/env';
import { ingestCandidate } from '../../src/services/ingest';
import { backfillEmbeddings } from './backfill-embeddings';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
let orgId: string;
let documentId: string;

const fakeEmbed = async () => { const v = new Array(3072).fill(0); v[0] = 1; return v; };

beforeAll(async () => {
  orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  const r = await ingestCandidate({
    org_id: orgId, full_name: 'Backfill Target',
    email: `backfill-${Date.now()}@example.com`,
    resume_text: 'resume text '.repeat(200), // > 1 chunk
  });
  documentId = r.document_id!;
});

describe('backfillEmbeddings', () => {
  it('embeds documents lacking vectors, then skips them on re-run', async () => {
    const first = await backfillEmbeddings({ orgId, embedFn: fakeEmbed });
    expect(first.embedded).toBeGreaterThanOrEqual(1);
    const [{ n }] = await sql`select count(*)::int as n from embeddings where subject_id = ${documentId}`;
    expect(n).toBeGreaterThanOrEqual(2); // multiple chunks

    const again = await backfillEmbeddings({ orgId, embedFn: fakeEmbed });
    const stillMine = (await sql`select count(*)::int as n from embeddings where subject_id = ${documentId}`)[0].n;
    expect(stillMine).toBe(n); // unchanged
    expect(again.embedded).toBe(0);
  });
});
