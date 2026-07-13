import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs } from './core';

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const client_contacts = pgTable('client_contacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  client_id: uuid('client_id').notNull().references(() => clients.id),
  full_name: text('full_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const prospects = pgTable('prospects', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  company_name: text('company_name').notNull(),
  signal: text('signal'),
  status: text('status').notNull().default('new'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
