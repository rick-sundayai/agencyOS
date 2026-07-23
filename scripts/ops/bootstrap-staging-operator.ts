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

    console.log('Operator password (copy now — it is not stored or shown again):');
    console.log(plaintext);
    await sql.end();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
