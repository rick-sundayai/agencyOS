import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../src/lib/env';
import { runMigrations } from './migrate';

describe('runMigrations', () => {
  it('applies all drizzle migrations to a fresh database', async () => {
    const admin = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const dbName = `migrate_test_${Date.now()}`;
    await admin.unsafe(`create database ${dbName}`);
    const freshUrl = getEnv('DATABASE_URL').replace(/\/[^/]+$/, `/${dbName}`);
    try {
      await runMigrations(freshUrl);
      const fresh = postgres(freshUrl, { max: 1 });
      const tables = await fresh`
        select table_name from information_schema.tables where table_schema = 'public'`;
      const names = tables.map((t) => t.table_name);
      expect(names).toContain('decisions');
      expect(names).toContain('candidate_documents');
      expect(names).toContain('embeddings');
      // idempotent: running again is a no-op, not an error
      await runMigrations(freshUrl);
      await fresh.end();
    } finally {
      await admin.unsafe(`drop database ${dbName} with (force)`);
      await admin.end();
    }
  }, 60000);
});
