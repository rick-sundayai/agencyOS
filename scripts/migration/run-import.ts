import 'dotenv/config';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  candidates, candidate_documents, clients, job_orders, migration_checkpoints,
} from '../../src/db/schema';
import { ingestCandidate } from '../../src/services/ingest';
import { JobDivaClient, type BiRow } from './jobdiva-client';
import { mapCandidate, mapJob, pickLatestResume } from './map';
import { sha256 } from './chunk';

export type ImportOpts = {
  orgId: string; since: string; until: string;
  dryRun: boolean; limit?: number; client?: JobDivaClient;
};
export type ImportResult = { jobs: number; candidates: number; resumes: number; skipped: number };

function* monthWindows(since: string, until: string): Generator<[string, string]> {
  let start = new Date(since + 'T00:00:00Z');
  const end = new Date(until + 'T00:00:00Z');
  while (start < end) {
    const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const stop = next < end ? next : end;
    yield [start.toISOString().slice(0, 10), stop.toISOString().slice(0, 10)];
    start = stop;
  }
}

async function checkpoint(orgId: string, source: string): Promise<string | null> {
  const [row] = await db.select().from(migration_checkpoints).where(and(
    eq(migration_checkpoints.org_id, orgId), eq(migration_checkpoints.source, source)));
  return row ? row.watermark.toISOString().slice(0, 10) : null;
}

async function advance(orgId: string, source: string, watermark: string) {
  await db.insert(migration_checkpoints)
    .values({ org_id: orgId, source, watermark: new Date(watermark + 'T00:00:00Z') })
    .onConflictDoUpdate({
      target: [migration_checkpoints.org_id, migration_checkpoints.source],
      set: { watermark: new Date(watermark + 'T00:00:00Z'), updated_at: new Date() },
    });
}

async function importJob(orgId: string, row: BiRow, dryRun: boolean): Promise<void> {
  const j = mapJob(row);
  if (!j.jobdiva_id) return;
  if (dryRun) { console.log('[dry] job', j.jobdiva_id, j.title); return; }

  let clientId: string | null = null;
  if (j.company_name) {
    const [existing] = await db.select().from(clients).where(and(
      eq(clients.org_id, orgId), eq(clients.name, j.company_name)));
    clientId = existing?.id
      ?? (await db.insert(clients).values({ org_id: orgId, name: j.company_name }).returning())[0].id;
  }

  const [current] = await db.select().from(job_orders).where(and(
    eq(job_orders.org_id, orgId), eq(job_orders.jobdiva_id, j.jobdiva_id)));
  if (current) {
    await db.update(job_orders).set({
      title: j.title, description: j.description, must_haves: j.must_haves, client_id: clientId,
    }).where(eq(job_orders.id, current.id));
  } else {
    await db.insert(job_orders).values({
      org_id: orgId, jobdiva_id: j.jobdiva_id, client_id: clientId,
      title: j.title, description: j.description, must_haves: j.must_haves,
      kind: j.kind, status: 'open',
    });
  }
}

async function importCandidate(
  orgId: string, row: BiRow, jd: JobDivaClient, dryRun: boolean,
): Promise<{ imported: boolean; resumeImported: boolean }> {
  const m = mapCandidate(row);
  if (!m.jobdiva_id) return { imported: false, resumeImported: false };
  if (dryRun) { console.log('[dry] candidate', m.jobdiva_id, m.full_name); return { imported: true, resumeImported: false }; }

  // Resume text (skippable by hash) — fetched before ingest so one ingest call does both.
  let resumeText: string | null = null;
  const resumeId = pickLatestResume(JobDivaClient.rows(await jd.candidateResumes(m.jobdiva_id)));
  if (resumeId) {
    const detail = JobDivaClient.rows(await jd.resumeDetail(resumeId))[0];
    resumeText = detail?.PLAINTEXT ? String(detail.PLAINTEXT) : null;
  }

  const [known] = await db.select().from(candidates).where(and(
    eq(candidates.org_id, orgId), eq(candidates.jobdiva_id, m.jobdiva_id)));

  let resumeImported = false;
  if (known && resumeText) {
    // Watermark check (ADR-0015 pattern): skip when the latest stored text hash matches.
    const [latestDoc] = await db.select().from(candidate_documents)
      .where(eq(candidate_documents.candidate_id, known.id))
      .orderBy(desc(candidate_documents.version)).limit(1);
    if (latestDoc?.parsed_text && sha256(latestDoc.parsed_text) === sha256(resumeText)) {
      resumeText = null; // unchanged — do not bump a version
    }
  }

  const { candidate_id, document_id } = await ingestCandidate({
    org_id: orgId, full_name: m.full_name, email: m.email, phone: m.phone,
    current_title: m.current_title, location: m.location, source: m.source,
    resume_text: resumeText,
  });
  resumeImported = document_id !== null;

  if (!known) {
    await db.update(candidates).set({ jobdiva_id: m.jobdiva_id }).where(eq(candidates.id, candidate_id));
  }
  return { imported: true, resumeImported };
}

export async function runImport(opts: ImportOpts): Promise<ImportResult> {
  const jd = opts.client ?? new JobDivaClient();
  const result: ImportResult = { jobs: 0, candidates: 0, resumes: 0, skipped: 0 };
  let budget = opts.limit ?? Infinity;

  for (const source of ['jobdiva-jobs', 'jobdiva-candidates'] as const) {
    const mark = opts.dryRun ? null : await checkpoint(opts.orgId, source);
    const since = mark && mark > opts.since ? mark : opts.since;
    for (const [from, to] of monthWindows(since, opts.until)) {
      const listResp = source === 'jobdiva-jobs'
        ? await jd.newUpdatedJobRecords(from, to)
        : await jd.newUpdatedCandidateRecords(from, to);
      const ids = [...new Set(JobDivaClient.rows(listResp).map((r) => String(r.ID ?? '')))].filter(Boolean);

      for (const id of ids) {
        if (budget-- <= 0) { console.log('limit reached'); return result; }
        try {
          if (source === 'jobdiva-jobs') {
            const detail = JobDivaClient.rows(await jd.jobDetail(id))[0];
            if (detail) { await importJob(opts.orgId, detail, opts.dryRun); result.jobs++; }
          } else {
            const detail = JobDivaClient.rows(await jd.candidateDetail(id))[0];
            if (detail) {
              const r = await importCandidate(opts.orgId, detail, jd, opts.dryRun);
              if (r.imported) result.candidates++;
              if (r.resumeImported) result.resumes++;
            }
          }
        } catch (err) {
          result.skipped++;
          console.error(`skip ${source} ${id}:`, err instanceof Error ? err.message : err);
        }
      }
      if (!opts.dryRun) await advance(opts.orgId, source, to);
      console.log(`${source} ${from}..${to}: done (${ids.length} ids)`);
    }
  }
  return result;
}

// CLI: npx tsx scripts/migration/run-import.ts --since 2015-01-01 [--until 2026-07-31] [--dry-run] [--limit 25]
if (process.argv[1]?.endsWith('run-import.ts')) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? null : process.argv[i + 1] ?? 'true';
  };
  (async () => {
    const postgres = (await import('postgres')).default;
    const { getEnv } = await import('../../src/lib/env');
    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id as string;
    await sql.end();
    const r = await runImport({
      orgId,
      since: arg('since') ?? '2015-01-01',
      until: arg('until') ?? new Date().toISOString().slice(0, 10),
      dryRun: process.argv.includes('--dry-run'),
      limit: arg('limit') ? Number(arg('limit')) : undefined,
    });
    console.log('import result:', r);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
