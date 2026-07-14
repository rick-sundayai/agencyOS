import 'dotenv/config';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { ACTION_CLASSES } from '../contracts/decision';
import { getEnv } from '../lib/env';

async function seed() {
  const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });

  const [existing] = await sql`select id from orgs where name = 'Sunday AI Work'`;
  const orgId = existing?.id
    ?? (await sql`insert into orgs (name) values ('Sunday AI Work') returning id`)[0].id;

  for (const [actionClass, tier] of Object.entries(ACTION_CLASSES)) {
    await sql`
      insert into autonomy_policy (org_id, action_class, tier)
      values (${orgId}, ${actionClass}, ${tier})
      on conflict (org_id, action_class) do nothing`;
  }

  const passwordHash = bcrypt.hashSync('change-me-locally', 10);
  await sql`
    insert into users (org_id, email, full_name, role, password_hash)
    values (${orgId}, 'rick@sundayaiwork.com', 'Rick', 'admin', ${passwordHash})
    on conflict (email) do nothing`;

  const [{ count }] = await sql`select count(*)::int as count from autonomy_policy where org_id = ${orgId}`;
  console.log(`Seeded org ${orgId} with ${count} policy rows`);
  await sql.end();
}

seed();
