import {
  pgTable, uuid, text, timestamp, jsonb, integer, unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs } from './core';
import { clients, client_contacts } from './crm';
import { candidates, job_orders } from './ats';

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  agent: text('agent').notNull(),
  action_class: text('action_class').notNull(),
  tier: text('tier').notNull(),
  state: text('state').notNull().default('proposed'),
  reasoning: jsonb('reasoning').notNull(),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  job_order_id: uuid('job_order_id').references(() => job_orders.id),
  candidate_id: uuid('candidate_id').references(() => candidates.id),
  client_id: uuid('client_id').references(() => clients.id),
  undo_expires_at: timestamp('undo_expires_at', { withTimezone: true }),
  approved_by: text('approved_by'), // 'policy' | user uuid
  cancelled_by: text('cancelled_by'), // user uuid; who cancelled (incl. undo-window cancels)
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  error: text('error'),
  outcome: jsonb('outcome'),
  proposed_at: timestamp('proposed_at', { withTimezone: true }).defaultNow().notNull(),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  executed_at: timestamp('executed_at', { withTimezone: true }),
});

export const autonomy_policy = pgTable('autonomy_policy', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  action_class: text('action_class').notNull(),
  tier: text('tier').notNull(),
  undo_minutes: integer('undo_minutes').notNull().default(15),
}, (t) => [unique().on(t.org_id, t.action_class)]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  candidate_id: uuid('candidate_id').references(() => candidates.id),
  client_contact_id: uuid('client_contact_id').references(() => client_contacts.id),
  channel: text('channel').notNull(), // 'email' | 'sms' | 'whatsapp' | 'voice' | 'linkedin'
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  conversation_id: uuid('conversation_id').notNull().references(() => conversations.id),
  direction: text('direction').notNull(), // 'inbound' | 'outbound'
  body: text('body').notNull(),
  decision_id: uuid('decision_id').references(() => decisions.id),
  sent_at: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
});

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  candidate_id: uuid('candidate_id').notNull().references(() => candidates.id),
  channel: text('channel').notNull(),
  status: text('status').notNull().default('unknown'), // 'granted' | 'revoked' | 'unknown'
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.candidate_id, t.channel)]);

export const agent_runs = pgTable('agent_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  agent: text('agent').notNull(),
  workflow: text('workflow').notNull(),
  model: text('model'),
  prompt_version: text('prompt_version'),
  tokens_in: integer('tokens_in'),
  tokens_out: integer('tokens_out'),
  status: text('status').notNull().default('running'),
  decision_id: uuid('decision_id').references(() => decisions.id),
  started_at: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finished_at: timestamp('finished_at', { withTimezone: true }),
});

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  name: text('name').notNull(),
  api_key_hash: text('api_key_hash').notNull().unique(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.org_id, t.name)]);
