import { z } from 'zod';
import { and, count, desc, eq, gt } from 'drizzle-orm';
import { db } from '../db/client';
import { conversations, messages, consents, system_prompts } from '../db/schema';

export const CHANNELS = ['email', 'sms', 'whatsapp', 'voice', 'linkedin'] as const;
export type Channel = (typeof CHANNELS)[number];

export const MessageLogSchema = z.strictObject({
  org_id: z.uuid(),
  candidate_id: z.uuid(),
  channel: z.enum(CHANNELS),
  direction: z.enum(['inbound', 'outbound']),
  body: z.string().min(1),
  decision_id: z.uuid().nullable().default(null),
});

export async function logMessage(input: unknown): Promise<{ conversation_id: string; message_id: string }> {
  const p = MessageLogSchema.parse(input);
  let [conv] = await db.select().from(conversations).where(and(
    eq(conversations.org_id, p.org_id),
    eq(conversations.candidate_id, p.candidate_id),
    eq(conversations.channel, p.channel),
  ));
  if (!conv) {
    [conv] = await db.insert(conversations)
      .values({ org_id: p.org_id, candidate_id: p.candidate_id, channel: p.channel })
      .returning();
  }
  const [msg] = await db.insert(messages).values({
    org_id: p.org_id, conversation_id: conv.id,
    direction: p.direction, body: p.body, decision_id: p.decision_id,
  }).returning();
  return { conversation_id: conv.id, message_id: msg.id };
}

export async function countRecentOutbound(
  orgId: string, candidateId: string, channel: Channel, days = 7,
): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select({ n: count() }).from(messages)
    .innerJoin(conversations, eq(messages.conversation_id, conversations.id))
    .where(and(
      eq(messages.org_id, orgId),
      eq(conversations.candidate_id, candidateId),
      eq(conversations.channel, channel),
      eq(messages.direction, 'outbound'),
      gt(messages.sent_at, since),
    ));
  return Number(rows[0]?.n ?? 0);
}

export async function getConsentStatus(
  orgId: string, candidateId: string, channel: Channel,
): Promise<'granted' | 'revoked' | 'unknown'> {
  const [row] = await db.select().from(consents).where(and(
    eq(consents.org_id, orgId),
    eq(consents.candidate_id, candidateId),
    eq(consents.channel, channel),
  ));
  return (row?.status as 'granted' | 'revoked' | undefined) ?? 'unknown';
}

/** Every recorded consent for a candidate (one row per channel), for the profile view. */
export async function listCandidateConsents(
  orgId: string, candidateId: string,
): Promise<Array<{ channel: string; status: string }>> {
  return db.select({ channel: consents.channel, status: consents.status })
    .from(consents)
    .where(and(eq(consents.org_id, orgId), eq(consents.candidate_id, candidateId)))
    .orderBy(consents.channel);
}

export type SystemPromptRow = typeof system_prompts.$inferSelect;

export async function getActivePrompt(
  orgId: string, agent: string, name: string,
): Promise<SystemPromptRow | null> {
  const [row] = await db.select().from(system_prompts)
    .where(and(
      eq(system_prompts.org_id, orgId),
      eq(system_prompts.agent, agent),
      eq(system_prompts.name, name),
      eq(system_prompts.active, true),
    ))
    .orderBy(desc(system_prompts.created_at))
    .limit(1);
  return row ?? null;
}
