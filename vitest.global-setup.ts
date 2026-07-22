import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { runMigrations } from './scripts/migrate';
import { TEST_DB_NAME, toTestDatabaseUrl } from './src/test/test-db';

/**
 * Creates the dedicated test database (if missing) and migrates it before any suite
 * runs. Workers get DATABASE_URL pointed at this database via vitest.config.ts, so
 * DB-touching tests can never write into the dev database's seeded org.
 */
export default async function setup(): Promise<void> {
  loadEnv({ path: '.env.local' });
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) return; // no database configured; DB-touching suites will fail loudly on getEnv

  const admin = postgres(devUrl, { max: 1, onnotice: () => {} });
  try {
    const [existing] = await admin`select 1 from pg_database where datname = ${TEST_DB_NAME}`;
    if (!existing) await admin.unsafe(`create database "${TEST_DB_NAME}"`);
  } finally {
    await admin.end();
  }
  await runMigrations(toTestDatabaseUrl(devUrl));
}
