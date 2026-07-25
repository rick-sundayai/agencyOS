import { describe, it, expect, vi } from 'vitest';
import { handleConfirm } from './route';

const okRun = vi.fn(async (_o: string, _d: string, _f: unknown) => ({
  candidate_id: 'c1', document_id: 'd1', embedding_status: 'embedded' as const,
}));

describe('handleConfirm', () => {
  it('returns 201 and the ingest result on a valid body', async () => {
    const res = await handleConfirm(
      { draft_id: 'draft-x', fields: { full_name: 'Ada', email: null, phone: null,
        current_title: null, location: null } }, 'org-1', okRun);
    expect(res.status).toBe(201);
    expect((await res.json()).candidate_id).toBe('c1');
    expect(okRun).toHaveBeenCalledWith('org-1', 'draft-x', expect.objectContaining({ full_name: 'Ada' }));
  });

  it('returns 400 when full_name is missing', async () => {
    const res = await handleConfirm(
      { draft_id: 'draft-x', fields: { full_name: '', email: null, phone: null,
        current_title: null, location: null } }, 'org-1', okRun);
    expect(res.status).toBe(400);
  });

  it('returns 400 when draft_id is missing', async () => {
    const res = await handleConfirm(
      { fields: { full_name: 'Ada', email: null, phone: null,
        current_title: null, location: null } }, 'org-1', okRun);
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is a non-empty malformed address', async () => {
    const res = await handleConfirm(
      { draft_id: 'draft-x', fields: { full_name: 'Ada', email: 'notanemail', phone: null,
        current_title: null, location: null } }, 'org-1', okRun);
    expect(res.status).toBe(400);
  });
});
