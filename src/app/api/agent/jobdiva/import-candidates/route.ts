import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { importCandidatesForJob } from '../../../../../services/jobdiva-import';
import { defaultJobDivaClient } from '../../../../../services/jobdiva';
import { defaultEmbedder } from '../../../../../services/embed';

const BodySchema = z.strictObject({
  job_order_id: z.uuid(),
  sourcing_run_id: z.uuid().nullable().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const p = BodySchema.parse(await req.json());
    let jobdiva, embed;
    try {
      jobdiva = defaultJobDivaClient();
      embed = defaultEmbedder();
    } catch (err) {
      return Response.json(
        { error: 'jobdiva_unavailable', message: String((err as Error).message) },
        { status: 502 },
      );
    }
    const out = await importCandidatesForJob(
      { org_id: auth.org_id, job_order_id: p.job_order_id, sourcing_run_id: p.sourcing_run_id },
      { jobdiva, embed },
    );
    return Response.json(out);
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    if (err instanceof Error && /job order not found/.test(err.message)) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (err instanceof Error && /jobdiva/i.test(err.message)) {
      return Response.json({ error: 'jobdiva_unavailable', message: err.message }, { status: 502 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
