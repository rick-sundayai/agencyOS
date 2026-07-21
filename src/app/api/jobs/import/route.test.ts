import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../../db/client';
import { job_orders, orgs } from '../../../../db/schema';
import { eq, and } from 'drizzle-orm';
import type { JobDivaJob } from '../../../../services/jobdiva';

const mockSession = vi.hoisted(() => ({ current: null as null | { user: { id: string; org_id: string } } }));
vi.mock('../../../../lib/auth', () => ({ auth: async () => mockSession.current }));

const mockJd = vi.hoisted(() => ({
  job: null as JobDivaJob | null,
  fail: false,
}));
vi.mock('../../../../services/jobdiva', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/jobdiva')>()),
  defaultJobDivaClient: () => ({
    getJob: async () => { if (mockJd.fail) throw new Error('jobdiva down'); return mockJd.job; },
    searchCandidates: async () => [],
    getResumeText: async () => null,
  }),
}));

import { POST } from './route';

function post(body: unknown) {
  return POST(new Request('http://test/api/jobs/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => { mockSession.current = null; mockJd.job = null; mockJd.fail = false; });

async function seedOrg() {
  const [org] = await db.insert(orgs).values({ name: `org-${randomUUID()}` }).returning();
  mockSession.current = { user: { id: randomUUID(), org_id: org.id } };
  return org;
}

describe('POST /api/jobs/import', () => {
  it('401s without a session', async () => {
    expect((await post({ jobdiva_job_number: '42' })).status).toBe(401);
  });

  it('returns the existing job order when the number is already imported', async () => {
    const org = await seedOrg();
    const [existing] = await db.insert(job_orders).values({
      org_id: org.id, title: 'Already here', kind: 'contract', jobdiva_id: 'JD-42',
    }).returning();
    const res = await post({ jobdiva_job_number: 'JD-42' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job_order_id: existing.id, created: false });
  });

  it('imports an unknown job from JobDiva', async () => {
    const org = await seedOrg();
    mockJd.job = {
      title: 'Platform Engineer', description: 'Build platforms',
      must_haves: ['Kubernetes'], nice_to_haves: [], kind: 'contract',
    };
    const res = await post({ jobdiva_job_number: 'JD-77' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    const [row] = await db.select().from(job_orders).where(and(
      eq(job_orders.org_id, org.id), eq(job_orders.jobdiva_id, 'JD-77'),
    ));
    expect(row.title).toBe('Platform Engineer');
  });

  it('404s when JobDiva does not know the number', async () => {
    await seedOrg();
    expect((await post({ jobdiva_job_number: 'JD-00' })).status).toBe(404);
  });

  it('502s when JobDiva is unreachable', async () => {
    await seedOrg();
    mockJd.fail = true;
    expect((await post({ jobdiva_job_number: 'JD-77' })).status).toBe(502);
  });
});
