import { z, ZodError } from 'zod';
import {
  confirmCandidateDraft, type ConfirmFields,
} from '../../../../services/candidate-drafts';
import { defaultStore } from '../../../../services/storage';
import { defaultEmbedder } from '../../../../services/embed';

// The review form sends '' for cleared optional fields. Coerce '' -> null BEFORE
// validation so empties don't reach ingestCandidate (whose email is z.email() and would
// reject ''). email is then validated as a real address, so a malformed one is a clean
// 400 here rather than a 500 out of ingest.
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const ConfirmBodySchema = z.strictObject({
  draft_id: z.string().min(1),
  fields: z.strictObject({
    full_name: z.string().trim().min(1),
    email: z.preprocess(emptyToNull, z.email().nullable()).default(null),
    phone: z.preprocess(emptyToNull, z.string().nullable()).default(null),
    current_title: z.preprocess(emptyToNull, z.string().nullable()).default(null),
    location: z.preprocess(emptyToNull, z.string().nullable()).default(null),
  }),
});

export async function handleConfirm(
  body: unknown, orgId: string,
  run: (orgId: string, draftId: string, fields: ConfirmFields) =>
    ReturnType<typeof confirmCandidateDraft>,
): Promise<Response> {
  let parsed: z.infer<typeof ConfirmBodySchema>;
  try { parsed = ConfirmBodySchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) {
      return Response.json({ error: 'validation_failed', issues: err.issues }, { status: 400 });
    }
    throw err;
  }
  try {
    const result = await run(orgId, parsed.draft_id, parsed.fields);
    return Response.json(result, { status: 201 });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  // Lazy import: keeps next-auth's module graph out of the load path for tests that
  // only exercise handleConfirm (see route.test.ts), and out of any bundle that only
  // needs handleConfirm's logic.
  const { auth } = await import('../../../../lib/auth');
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;
  const body = await req.json().catch(() => null);
  return handleConfirm(body, orgId, (o, d, f) =>
    confirmCandidateDraft(o, d, f, { store: defaultStore(), embed: defaultEmbedder() }));
}
