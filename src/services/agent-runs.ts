import { z } from 'zod';
import { db } from '../db/client';
import { agent_runs } from '../db/schema';
import { AGENTS } from '../contracts/decision';

export const AgentRunSchema = z.strictObject({
  org_id: z.uuid(),
  agent: z.enum(AGENTS),
  workflow: z.string().min(1),
  model: z.string().nullable().default(null),
  prompt_version: z.string().nullable().default(null),
  tokens_in: z.number().int().nullable().default(null),
  tokens_out: z.number().int().nullable().default(null),
  status: z.string().default('succeeded'),
  decision_id: z.uuid().nullable().default(null),
});

export type AgentRunRow = typeof agent_runs.$inferSelect;

export async function insertAgentRun(input: unknown): Promise<AgentRunRow> {
  const p = AgentRunSchema.parse(input);
  const [row] = await db.insert(agent_runs).values({ ...p, finished_at: new Date() }).returning();
  return row;
}
