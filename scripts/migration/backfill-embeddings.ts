import 'dotenv/config';
import { db } from '../../src/db/client';
import { sql as dsql } from 'drizzle-orm';
import { upsertEmbeddings } from '../../src/services/ingest';
import { chunkText, sha256 } from './chunk';

async function geminiEmbed(text: string): Promise<number[]> {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 3072,
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini embed failed: ${res.status}`);
  return (await res.json()).embedding.values as number[];
}

export async function backfillEmbeddings(opts: {
  orgId: string; limit?: number; embedFn?: (text: string) => Promise<number[]>;
}): Promise<{ embedded: number; skipped: number }> {
  const embed = opts.embedFn ?? geminiEmbed;
  // Latest-version resume docs with text and no embedding rows.
  const docs = (await db.execute(dsql`
    select cd.id, cd.parsed_text
    from candidate_documents cd
    where cd.org_id = ${opts.orgId}
      and cd.parsed_text is not null
      and cd.version = (select max(v.version) from candidate_documents v where v.candidate_id = cd.candidate_id)
      and not exists (select 1 from embeddings e where e.subject_id = cd.id and e.subject_type = 'candidate_document')
    limit ${opts.limit ?? 100000}`)) as unknown as Array<{ id: string; parsed_text: string }>;

  let embedded = 0; let skipped = 0;
  for (const doc of docs) {
    try {
      const chunks = chunkText(doc.parsed_text);
      const rows: Array<{ chunk_index: number; content: string; embedding: number[]; content_hash: string }> = [];
      // Concurrency 2 on Gemini (Gemini-side limit, generous; JobDiva is not involved here).
      for (let i = 0; i < chunks.length; i += 2) {
        const pair = chunks.slice(i, i + 2);
        const vecs = await Promise.all(pair.map((c) => embed(c)));
        pair.forEach((c, k) => rows.push({
          chunk_index: i + k, content: c, embedding: vecs[k], content_hash: sha256(c),
        }));
      }
      await upsertEmbeddings({
        org_id: opts.orgId, subject_type: 'candidate_document', subject_id: doc.id, chunks: rows,
      });
      embedded++;
      if (embedded % 25 === 0) console.log(`embedded ${embedded}/${docs.length} docs`);
    } catch (err) {
      skipped++;
      console.error(`skip doc ${doc.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { embedded, skipped };
}

if (process.argv[1]?.endsWith('backfill-embeddings.ts')) {
  (async () => {
    const postgres = (await import('postgres')).default;
    const { getEnv } = await import('../../src/lib/env');
    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id as string;
    await sql.end();
    const i = process.argv.indexOf('--limit');
    console.log(await backfillEmbeddings({ orgId, limit: i === -1 ? undefined : Number(process.argv[i + 1]) }));
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
