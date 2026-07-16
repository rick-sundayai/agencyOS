import { ZodError } from 'zod';
import { requireAgentKey } from '../../../../lib/agent-auth';
import { upsertEmbeddings } from '../../../../services/ingest';

export async function POST(req: Request): Promise<Response> {
  const denied = requireAgentKey(req);
  if (denied) return denied;
  try {
    return Response.json(await upsertEmbeddings(await req.json()), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
