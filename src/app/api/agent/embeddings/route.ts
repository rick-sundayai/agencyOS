import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { upsertEmbeddings, getStoredEmbeddings } from '../../../../services/ingest';

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json();
    return Response.json(await upsertEmbeddings({ ...body, org_id: auth.org_id }), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

const GetQuerySchema = z.object({
  subject_type: z.enum(['candidate_document', 'job_order']),
  subject_id: z.uuid(),
});

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const parsed = GetQuerySchema.safeParse({
    subject_type: url.searchParams.get('subject_type'),
    subject_id: url.searchParams.get('subject_id'),
  });
  if (!parsed.success) {
    return Response.json({ error: 'validation_failed', issues: parsed.error.issues }, { status: 400 });
  }
  const chunks = await getStoredEmbeddings(auth.org_id, parsed.data.subject_type, parsed.data.subject_id);
  return Response.json({ chunks });
}
