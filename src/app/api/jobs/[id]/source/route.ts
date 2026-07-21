import { and, eq } from 'drizzle-orm';
import { auth } from '../../../../../lib/auth';
import { db } from '../../../../../db/client';
import { job_orders } from '../../../../../db/schema';
import { fireSourcingWebhook } from '../../../../../lib/n8n';
import {
  createSourcingRun, getLatestSourcingRun, getSourcingShortlist, updateSourcingRun,
} from '../../../../../services/sourcing-runs';

async function requireJob(orgId: string, id: string) {
  const [job] = await db.select().from(job_orders).where(and(
    eq(job_orders.org_id, orgId), eq(job_orders.id, id),
  ));
  return job ?? null;
}

export async function POST(
  _req: Request, { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;
  const { id } = await params;

  const job = await requireJob(orgId, id);
  if (!job) return Response.json({ error: 'not_found' }, { status: 404 });

  const res = await createSourcingRun({
    org_id: orgId, job_order_id: id, requested_by: session.user.id ?? null,
  });
  if (!res.created) {
    return Response.json({ error: 'run_active', sourcing_run_id: res.active.id }, { status: 409 });
  }

  const fired = await fireSourcingWebhook({
    org_id: orgId, job_order_id: id, sourcing_run_id: res.run.id,
  });
  if (!fired.ok) {
    // Fail fast and visibly — the recruiter sees it in the panel, nothing hangs in 'queued'.
    await updateSourcingRun(orgId, res.run.id, {
      phase: 'failed',
      error: `Couldn't reach the agent runtime: ${fired.error ?? 'unknown error'}`,
    });
  }
  return Response.json({ sourcing_run_id: res.run.id }, { status: 201 });
}

export async function GET(
  _req: Request, { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;
  const { id } = await params;

  const [run, shortlist] = await Promise.all([
    getLatestSourcingRun(orgId, id),
    getSourcingShortlist(orgId, id),
  ]);
  return Response.json({ run, shortlist });
}
