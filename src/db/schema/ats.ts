import {
  pgTable, uuid, text, timestamp, jsonb, integer, date, numeric, unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs } from './core';
import { clients } from './crm';

export const job_orders = pgTable('job_orders', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  client_id: uuid('client_id').references(() => clients.id),
  title: text('title').notNull(),
  description: text('description'),
  must_haves: jsonb('must_haves').notNull().default(sql`'[]'::jsonb`),
  nice_to_haves: jsonb('nice_to_haves').notNull().default(sql`'[]'::jsonb`),
  kind: text('kind').notNull(), // 'contract' | 'direct_hire'
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  jobdiva_id: text('jobdiva_id'),
});

export const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  full_name: text('full_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  current_title: text('current_title'),
  location: text('location'),
  source: text('source'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  jobdiva_id: text('jobdiva_id'),
});

export const candidate_documents = pgTable('candidate_documents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  candidate_id: uuid('candidate_id').notNull().references(() => candidates.id),
  kind: text('kind').notNull().default('resume'),
  storage_key: text('storage_key').notNull(),
  parsed_text: text('parsed_text'),
  version: integer('version').notNull().default(1),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  job_order_id: uuid('job_order_id').notNull().references(() => job_orders.id),
  candidate_id: uuid('candidate_id').notNull().references(() => candidates.id),
  stage: text('stage').notNull().default('sourced'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.job_order_id, t.candidate_id)]);

export const placements = pgTable('placements', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  application_id: uuid('application_id').notNull().references(() => applications.id),
  kind: text('kind').notNull(), // 'contract' | 'direct_hire'
  start_date: date('start_date'),
  end_date: date('end_date'),
  bill_rate: numeric('bill_rate'),
  pay_rate: numeric('pay_rate'),
  fee_amount: numeric('fee_amount'),
  status: text('status').notNull().default('active'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const timesheets = pgTable('timesheets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  placement_id: uuid('placement_id').notNull().references(() => placements.id),
  week_ending: date('week_ending').notNull(),
  status: text('status').notNull().default('pending'),
  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
