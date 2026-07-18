import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  (async () => {
    const { getEnv } = await import('../src/lib/env');
    await runMigrations(getEnv('DATABASE_URL'));
    console.log('migrations applied');
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
