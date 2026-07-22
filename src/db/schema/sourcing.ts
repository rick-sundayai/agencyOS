import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs, users } from './core';
import { job_orders } from './ats';

// One row per Source click (or orchestrator-triggered run). `phase` is advanced by the
// n8n sourcing workflow via PATCH /api/agent/sourcing-runs/:id; the job page polls it.
export const sourcing_runs = pgTable('sourcing_runs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  job_order_id: uuid('job_order_id').notNull().references(() => job_orders.id),
  requested_by: uuid('requested_by').references(() => users.id),
  // Phase vocabulary is owned by SOURCING_PHASES in src/contracts/sourcing.ts (the source
  // of truth); the agent PATCH route validates writes against it.
  phase: text('phase').notNull().default('queued'),
  stats: jsonb('stats').notNull().default(sql`'{}'::jsonb`),
  error: text('error'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
