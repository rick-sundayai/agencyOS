import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

export function generateOperatorPassword(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(18).toString('base64url');
  return { plaintext, hash: bcrypt.hashSync(plaintext, 10) };
}

if (process.argv[1]?.endsWith('bootstrap-staging-operator.ts')) {
  (async () => {
    const postgres = (await import('postgres')).default;
    const { getEnv } = await import('../../src/lib/env');

    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });

    const [existingOrg] = await sql`select id from orgs where name = 'Sunday AI Work'`;
    const orgId = existingOrg?.id
      ?? (await sql`insert into orgs (name) values ('Sunday AI Work') returning id`)[0].id;

    const { plaintext, hash } = generateOperatorPassword();
    await sql`
      insert into users (org_id, email, full_name, role, password_hash)
      values (${orgId}, 'rick@sundayaiwork.com', 'Rick', 'admin', ${hash})
      on conflict (email) do update set password_hash = excluded.password_hash`;

    // Marker lets a Cloud Logging exclusion (infra/modules/stamp/main.tf) drop these
    // two lines from durable storage — this job runs via `gcloud run jobs execute`,
    // whose stdout is otherwise captured into Cloud Logging by default.
    console.log('ONE_TIME_SECRET:: Operator password (copy now — it is not stored or shown again):');
    console.log(`ONE_TIME_SECRET:: ${plaintext}`);
    await sql.end();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
