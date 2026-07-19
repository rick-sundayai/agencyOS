import { z, ZodError } from 'zod';
import { requireAgentKey } from '../../../../../lib/agent-auth';
import { searchCandidatesByEmbedding } from '../../../../../services/matching';

const SearchSchema = z.strictObject({
  org_id: z.uuid(),
  query_embedding: z.array(z.number()).length(3072),
  limit: z.number().int().min(1).max(100).default(10),
});

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAgentKey(req);
  if (auth instanceof Response) return auth;
  try {
    const p = SearchSchema.parse(await req.json());
    const results = await searchCandidatesByEmbedding(p.org_id, p.query_embedding, p.limit);
    return Response.json({ results });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
