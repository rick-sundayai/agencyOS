import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  email: text('email').notNull().unique(),
  full_name: text('full_name'),
  role: text('role').notNull().default('recruiter'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
