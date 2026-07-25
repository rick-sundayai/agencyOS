import { describe, it, expect } from 'vitest';
import { handleUpload } from './route';
import type { DraftDeps } from '../../../../services/candidate-drafts';
import { UnsupportedResumeError } from '../../../../services/resume-extract';

function reqWith(file: File): Request {
  const fd = new FormData();
  fd.set('file', file);
  return new Request('http://x/api/candidates/upload', { method: 'POST', body: fd });
}
const okDeps: DraftDeps = {
  store: { async put() {}, async getText() { return ''; }, async move() {},
    async signedReadUrl() { return ''; } },
  extractText: async () => 'text',
  extractFields: async () => ({ full_name: 'Ada', email: null, phone: null,
    current_title: null, location: null }),
  newId: () => 'draft-x',
};

describe('handleUpload', () => {
  it('returns 201 with a draft on a good upload', async () => {
    const file = new File([new Uint8Array([1, 2])], 'r.pdf', { type: 'application/pdf' });
    const res = await handleUpload(reqWith(file), 'org-1', okDeps);
    expect(res.status).toBe(201);
    expect((await res.json()).draft_id).toBe('draft-x');
  });

  it('returns 422 when no file is attached', async () => {
    const req = new Request('http://x', { method: 'POST', body: new FormData() });
    expect((await handleUpload(req, 'org-1', okDeps)).status).toBe(422);
  });

  it('maps UnsupportedResumeError to 415', async () => {
    const deps = { ...okDeps, extractText: async () => { throw new UnsupportedResumeError(); } };
    const file = new File([new Uint8Array([1])], 'r.doc', { type: 'application/msword' });
    expect((await handleUpload(reqWith(file), 'org-1', deps)).status).toBe(415);
  });

  it('returns 413 when the file exceeds the size cap', async () => {
    const file = new File([new Uint8Array(1024)], 'r.pdf', { type: 'application/pdf' });
    expect((await handleUpload(reqWith(file), 'org-1', okDeps, 512)).status).toBe(413);
  });
});
