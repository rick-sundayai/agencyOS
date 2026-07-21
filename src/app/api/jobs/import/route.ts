import { z, ZodError } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '../../../../lib/auth';
import { db } from '../../../../db/client';
import { job_orders } from '../../../../db/schema';
import { defaultJobDivaClient } from '../../../../services/jobdiva';

const BodySchema = z.strictObject({ jobdiva_job_number: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;
  try {
    const { jobdiva_job_number } = BodySchema.parse(await req.json());

    const [existing] = await db.select().from(job_orders).where(and(
      eq(job_orders.org_id, orgId), eq(job_orders.jobdiva_id, jobdiva_job_number),
    ));
    if (existing) return Response.json({ job_order_id: existing.id, created: false });

    let job;
    try {
      job = await defaultJobDivaClient().getJob(jobdiva_job_number);
    } catch (err) {
      return Response.json(
        { error: 'jobdiva_unavailable', message: String((err as Error).message) },
        { status: 502 },
      );
    }
    if (!job) return Response.json({ error: 'job_not_found_in_jobdiva' }, { status: 404 });

    const [row] = await db.insert(job_orders).values({
      org_id: orgId, title: job.title, description: job.description,
      must_haves: job.must_haves, nice_to_haves: job.nice_to_haves,
      kind: job.kind, jobdiva_id: jobdiva_job_number,
    }).returning();
    return Response.json({ job_order_id: row.id, created: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
