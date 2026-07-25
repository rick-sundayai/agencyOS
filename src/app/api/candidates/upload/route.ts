import {
  prepareCandidateDraft, type DraftDeps,
} from '../../../../services/candidate-drafts';
import { defaultStore } from '../../../../services/storage';
import {
  extractResumeText, UnsupportedResumeError, EmptyResumeError, type ResumeFile,
} from '../../../../services/resume-extract';
import { extractCandidateFields } from '../../../../services/resume-fields';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function defaultDeps(): DraftDeps {
  return {
    store: defaultStore(),
    extractText: (f: ResumeFile) => extractResumeText(f),
    extractFields: (t: string) => extractCandidateFields(t),
    newId: () => crypto.randomUUID(),
  };
}

export async function handleUpload(
  req: Request, orgId: string, deps: DraftDeps, maxBytes = MAX_BYTES,
): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return Response.json({ error: 'expected_multipart' }, { status: 400 }); }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: 'no_file' }, { status: 422 });
  }
  if (file.size > maxBytes) {
    return Response.json({ error: 'file_too_large' }, { status: 413 });
  }

  const resumeFile: ResumeFile = {
    bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, filename: file.name,
  };
  try {
    const draft = await prepareCandidateDraft(orgId, resumeFile, deps);
    return Response.json(draft, { status: 201 });
  } catch (err) {
    if (err instanceof UnsupportedResumeError) {
      return Response.json({ error: 'unsupported_type', message: err.message }, { status: 415 });
    }
    if (err instanceof EmptyResumeError) {
      return Response.json({ error: 'empty_resume', message: err.message }, { status: 422 });
    }
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  // Lazy import: keeps next-auth's module graph out of the load path for tests that
  // only exercise handleUpload (see route.test.ts), and out of any bundle that only
  // needs handleUpload's logic.
  const { auth } = await import('../../../../lib/auth');
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return handleUpload(req, session.user.org_id, defaultDeps());
}
