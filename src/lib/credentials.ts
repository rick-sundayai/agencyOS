import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import type { Role } from '../contracts/decision';

export type AuthedUser = { id: string; org_id: string; email: string; name: string | null; role: Role };

export async function verifyUser(email: string, password: string): Promise<AuthedUser | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  if (!row?.password_hash) return null;
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return null;
  return { id: row.id, org_id: row.org_id, email: row.email, name: row.full_name, role: row.role as Role };
}

/** Fresh, uncached read — the source of truth for authorization checks that must reflect
 *  a role change immediately, unlike the JWT-cached session.user.role (see Task 3). */
export async function getCurrentRole(userId: string): Promise<Role | null> {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return (row?.role as Role) ?? null;
}
