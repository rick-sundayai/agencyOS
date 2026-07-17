import {
  pgTable, uuid, text, timestamp, unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgs } from './core';

export const migration_checkpoints = pgTable('migration_checkpoints', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  org_id: uuid('org_id').notNull().references(() => orgs.id),
  source: text('source').notNull(), // 'jobdiva-jobs' | 'jobdiva-candidates'
  watermark: timestamp('watermark', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.org_id, t.source)]);
