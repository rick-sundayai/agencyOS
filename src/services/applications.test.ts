import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { applications, candidates, job_orders } from '../db/schema';
import { seedTestAgentInFreshOrg } from '../test-support/seed-agent';
import { upsertSourcedApplications } from './applications';

async function seed(orgId: string) {
  const [job] = await db.insert(job_orders).values({
    org_id: orgId, title: `Job ${randomUUID()}`, kind: 'contract',
  }).returning();
  const [c1] = await db.insert(candidates).values({ org_id: orgId, full_name: 'Ada L' }).returning();
  const [c2] = await db.insert(candidates).values({ org_id: orgId, full_name: 'Grace H' }).returning();
  return { job, c1, c2 };
}

describe('upsertSourcedApplications', () => {
  it('inserts sourced applications, skipping existing ones without touching their stage', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const { job, c1, c2 } = await seed(orgId);
    await db.insert(applications).values({
      org_id: orgId, job_order_id: job.id, candidate_id: c1.id, stage: 'interviewing',
    });

    const res = await upsertSourcedApplications(orgId, job.id, [c1.id, c2.id]);
    expect(res.inserted).toBe(1);

    const [existing] = await db.select().from(applications).where(and(
      eq(applications.job_order_id, job.id), eq(applications.candidate_id, c1.id),
    ));
    expect(existing.stage).toBe('interviewing');
    const [added] = await db.select().from(applications).where(and(
      eq(applications.job_order_id, job.id), eq(applications.candidate_id, c2.id),
    ));
    expect(added.stage).toBe('sourced');
  });

  it('handles an empty candidate list', async () => {
    const { orgId } = await seedTestAgentInFreshOrg();
    const { job } = await seed(orgId);
    const res = await upsertSourcedApplications(orgId, job.id, []);
    expect(res.inserted).toBe(0);
  });
});
