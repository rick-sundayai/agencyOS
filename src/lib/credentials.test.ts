import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { getEnv } from './env';
import { verifyUser, getCurrentRole } from './credentials';

const sql = postgres(getEnv('DATABASE_URL'), { max: 1 });
const email = `login-test-${Date.now()}@example.com`;

beforeAll(async () => {
  const orgId = (await sql`select id from orgs where name = 'Sunday AI Work'`)[0].id;
  await sql`
    insert into users (org_id, email, full_name, password_hash)
    values (${orgId}, ${email}, 'Test User', ${bcrypt.hashSync('pw-123', 10)})`;
});
afterAll(async () => { await sql.end(); });

describe('verifyUser', () => {
  it('returns id/org_id/email/name/role on correct credentials', async () => {
    const u = await verifyUser(email, 'pw-123');
    expect(u).not.toBeNull();
    expect(u!.email).toBe(email);
    expect(u!.name).toBe('Test User');
    expect(u!.org_id).toBeTruthy();
    expect(u!.role).toBe('recruiter'); // fixture insert omits role → schema default
  });

  it('returns null on wrong password', async () => {
    expect(await verifyUser(email, 'wrong')).toBeNull();
  });

  it('returns null for an unknown email', async () => {
    expect(await verifyUser('ghost@example.com', 'pw-123')).toBeNull();
  });
});

describe('getCurrentRole', () => {
  it('reads the current DB value, not a cached one — reflects a role change immediately', async () => {
    const u = await verifyUser(email, 'pw-123');
    expect(await getCurrentRole(u!.id)).toBe('recruiter');
    await sql`update users set role = 'admin' where id = ${u!.id}`;
    expect(await getCurrentRole(u!.id)).toBe('admin'); // no caching layer to go stale
  });

  it('returns null for an unknown user id', async () => {
    expect(await getCurrentRole('00000000-0000-7000-8000-000000000000')).toBeNull();
  });
});
