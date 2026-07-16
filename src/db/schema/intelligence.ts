import {
  pgTable, uuid, text, timestamp, jsonb, integer, numeric, boolean, unique, customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs } from './core';
import { candidates, job_orders } from './ats';

const halfvec = customType<{ data: number[]; driverData: string }>({
  dataType() { return 'halfvec(3072)'; },
  toDriver(value: number[]): string { return `[${value.join(',')}]`; },
});

export const embeddings = pgTable('embeddings', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  subject_type: text('subject_type').notNull(), // 'candidate_document' | 'job_order'
  subject_id: uuid('subject_id').notNull(),
  chunk_index: integer('chunk_index').notNull().default(0),
  content: text('content').notNull(),
  embedding: halfvec('embedding').notNull(),
  content_hash: text('content_hash').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const scores = pgTable('scores', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  job_order_id: uuid('job_order_id').notNull().references(() => job_orders.id),
  candidate_id: uuid('candidate_id').notNull().references(() => candidates.id),
  prompt_version: text('prompt_version').notNull(),
  model: text('model').notNull(),
  fit_rating: text('fit_rating').notNull(), // 'yes' | 'borderline' | 'no'
  weighted_score: numeric('weighted_score'),
  criteria: jsonb('criteria').notNull().default(sql`'{}'::jsonb`),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const system_prompts = pgTable('system_prompts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  agent: text('agent').notNull(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  body: text('body').notNull(),
  active: boolean('active').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.org_id, t.agent, t.name, t.version)]);
