import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { getEnv } from '../lib/env';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });

async function tableColumns(table: string): Promise<string[]> {
  const rows = await sql`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table}`;
  return rows.map((r) => r.column_name as string);
}

describe('core schema', () => {
  it('orgs exists with id/name/created_at', async () => {
    expect(await tableColumns('orgs')).toEqual(
      expect.arrayContaining(['id', 'name', 'created_at']),
    );
  });
  it('users exists and is org-scoped', async () => {
    expect(await tableColumns('users')).toEqual(
      expect.arrayContaining(['id', 'org_id', 'email', 'full_name', 'role']),
    );
  });
});
