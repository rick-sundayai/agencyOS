import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { hashApiKey } from '../../src/lib/agent-auth';

export function generateAgentKey(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString('hex');
  return { plaintext, hash: hashApiKey(plaintext) };
}

if (process.argv[1]?.endsWith('create-agent-key.ts')) {
  (async () => {
    const postgres = (await import('postgres')).default;
    const { getEnv } = await import('../../src/lib/env');

    const nameIdx = process.argv.indexOf('--name');
    const name = nameIdx === -1 ? null : process.argv[nameIdx + 1];
    if (!name) {
      console.error('Usage: npx tsx scripts/agents/create-agent-key.ts --name <agent-name> [--org <org-name>]');
      process.exit(1);
    }
    const orgIdx = process.argv.indexOf('--org');
    const orgName = orgIdx === -1 ? 'Sunday AI Work' : process.argv[orgIdx + 1];

    const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
    const [org] = await sql`select id from orgs where name = ${orgName}`;
    if (!org) {
      console.error(`No org named "${orgName}"`);
      await sql.end();
      process.exit(1);
    }

    const { plaintext, hash } = generateAgentKey();
    await sql`
      insert into agents (org_id, name, api_key_hash)
      values (${org.id}, ${name}, ${hash})
      on conflict (org_id, name) do update set api_key_hash = excluded.api_key_hash`;

    console.log(`Agent "${name}" key (copy now — it is not stored or shown again):`);
    console.log(plaintext);
    await sql.end();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
