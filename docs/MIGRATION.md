# JobDiva → AgencyOS migration runbook (one-way)

Order of operations. Each step is safe to repeat — the import is idempotent
(jobdiva_id upserts + resume-hash watermark) and the backfill is resumable.

**⚠️ Client caveat**: Company/client records are currently matched by name only, not a stable JobDiva id. Re-running the import with a renamed or duplicate company string may create a second `clients` row. This is deferred pending live fixture capture (Step 1) confirming whether JobDiva's job records expose a stable company/client identifier. Revisit before relying on repeated production runs.

1. **Fixture capture** — `npx tsx scripts/migration/capture-fixtures.ts`
   Confirms endpoints, date format, field names. Inspect `scripts/migration/fixtures/`.
2. **Dry run** — `npx tsx scripts/migration/run-import.ts --since 2026-06-01 --dry-run --limit 10`
3. **Limited real run (local DB)** — same command without `--dry-run`; verify in the cockpit.
4. **Full run against production RDS** —
   `DATABASE_URL=<rds-agency-url> npx tsx scripts/migration/run-import.ts --since 2015-01-01`
   Sequential by design; a large book takes hours. Re-run on interruption — checkpoints resume.
   (Adjust `--since` to when the agency's JobDiva history starts.)
5. **Embedding backfill** — `DATABASE_URL=<rds> GEMINI_API_KEY=<key> npx tsx scripts/migration/backfill-embeddings.ts`
6. **Reconcile** — `DATABASE_URL=<rds> npx tsx scripts/migration/report.ts`; compare counts to JobDiva.
   Note: if Step 4's console output showed a non-zero `skipped` count, those records failed and the checkpoint has already moved past them — reconcile will show them as gaps. Re-run the import with `--since`/`--until` covering just those ids to retry.
7. **Cutover** — when counts reconcile: stop creating/editing records in JobDiva; record
   "JobDiva read-only as of <date>" in `Agentic_Recruiting/Project_State.md`. JobDiva stays
   available read-only for reference; nothing syncs in either direction after this point.

Rate limit: JobDiva's per-minute limit is undocumented and self-healing. The client is
sequential with exponential backoff. If runs stall on repeated 429s, wait a few minutes;
do not add parallelism.
