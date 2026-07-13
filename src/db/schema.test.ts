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

describe('crm + ats schema', () => {
  it.each([
    ['clients', ['id', 'org_id', 'name', 'status']],
    ['client_contacts', ['id', 'org_id', 'client_id', 'full_name', 'email']],
    ['prospects', ['id', 'org_id', 'company_name', 'signal', 'status']],
    ['job_orders', ['id', 'org_id', 'client_id', 'title', 'must_haves', 'nice_to_haves', 'kind', 'status']],
    ['candidates', ['id', 'org_id', 'full_name', 'email', 'phone', 'current_title', 'source']],
    ['candidate_documents', ['id', 'org_id', 'candidate_id', 'kind', 'storage_key', 'parsed_text', 'version']],
    ['applications', ['id', 'org_id', 'job_order_id', 'candidate_id', 'stage']],
    ['placements', ['id', 'org_id', 'application_id', 'kind', 'start_date', 'bill_rate', 'pay_rate', 'fee_amount']],
    ['timesheets', ['id', 'org_id', 'placement_id', 'week_ending', 'status']],
  ])('%s has expected columns', async (table, cols) => {
    expect(await tableColumns(table)).toEqual(expect.arrayContaining(cols));
  });

  it('applications is unique per job_order + candidate', async () => {
    const rows = await sql`
      select 1 from pg_indexes
      where tablename = 'applications' and indexdef ilike '%unique%job_order_id%candidate_id%'`;
    expect(rows.length).toBe(1);
  });
});
