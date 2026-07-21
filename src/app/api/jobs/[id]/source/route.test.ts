import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../../../db/client';
import { job_orders, orgs, sourcing_runs, users } from '../../../../../db/schema';
import { eq } from 'drizzle-orm';

const mockSession = vi.hoisted(() => ({ current: null as null | { user: { id: string; org_id: string } } }));
vi.mock('../../../../../lib/auth', () => ({
  auth: async () => mockSession.current,
}));
const mockWebhook = vi.hoisted(() => ({ result: { ok: true } as { ok: boolean; error?: string } }));
vi.mock('../../../../../lib/n8n', () => ({
  fireSourcingWebhook: async () => mockWebhook.result,
}));

import { POST, GET } from './route';

async function seedOrgJob() {
  const [org] = await db.insert(orgs).values({ name: `org-${randomUUID()}` }).returning();
  const [job] = await db.insert(job_orders).values({
    org_id: org.id, title: 'T', kind: 'contract',
  }).returning();
  // sourcing_runs.requested_by FKs to users, so the session user must be a real row —
  // unlike the org/job seed, the brief's plain randomUUID() would violate that constraint.
  const [user] = await db.insert(users).values({
    org_id: org.id, email: `user-${randomUUID()}@test.local`,
  }).returning();
  mockSession.current = { user: { id: user.id, org_id: org.id } };
  return { org, job };
}

function call(method: 'POST' | 'GET', id: string) {
  const req = new Request(`http://test/api/jobs/${id}/source`, { method });
  const ctx = { params: Promise.resolve({ id }) };
  return method === 'POST' ? POST(req, ctx) : GET(req, ctx);
}

beforeEach(() => { mockSession.current = null; mockWebhook.result = { ok: true }; });

describe('POST /api/jobs/[id]/source', () => {
  it('401s without a session', async () => {
    expect((await call('POST', randomUUID())).status).toBe(401);
  });

  it('creates a run and fires the webhook', async () => {
    const { job } = await seedOrgJob();
    const res = await call('POST', job.id);
    expect(res.status).toBe(201);
    const { sourcing_run_id } = await res.json();
    const [run] = await db.select().from(sourcing_runs).where(eq(sourcing_runs.id, sourcing_run_id));
    expect(run.job_order_id).toBe(job.id);
  });

  it('409s while a run is active', async () => {
    const { job } = await seedOrgJob();
    expect((await call('POST', job.id)).status).toBe(201);
    expect((await call('POST', job.id)).status).toBe(409);
  });

  it('marks the run failed when the webhook cannot be reached', async () => {
    const { job } = await seedOrgJob();
    mockWebhook.result = { ok: false, error: 'connect ECONNREFUSED' };
    const res = await call('POST', job.id);
    expect(res.status).toBe(201);
    const { sourcing_run_id } = await res.json();
    const [run] = await db.select().from(sourcing_runs).where(eq(sourcing_runs.id, sourcing_run_id));
    expect(run.phase).toBe('failed');
    expect(run.error).toMatch(/agent runtime/i);
  });

  it('404s for a job in another org', async () => {
    const { job } = await seedOrgJob();
    const [otherOrg] = await db.insert(orgs).values({ name: `org-${randomUUID()}` }).returning();
    mockSession.current = { user: { id: randomUUID(), org_id: otherOrg.id } };
    expect((await call('POST', job.id)).status).toBe(404);
  });
});

describe('GET /api/jobs/[id]/source', () => {
  it('returns null run and shortlist before any sourcing', async () => {
    const { job } = await seedOrgJob();
    const res = await call('GET', job.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run: null, shortlist: null });
  });

  it('returns the active run after POST', async () => {
    const { job } = await seedOrgJob();
    await call('POST', job.id);
    const { run } = await (await call('GET', job.id)).json();
    expect(run.phase).toBe('queued');
  });
});
