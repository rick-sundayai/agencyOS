import { describe, it, expect, vi } from 'vitest';
import { prepareCandidateDraft, stagingKey, stagingTextKey } from './candidate-drafts';
import type { ObjectStore } from './storage';

function fakeStore(): ObjectStore & { puts: Array<[string, string]> } {
  const puts: Array<[string, string]> = [];
  return {
    puts,
    async put(key, _b, contentType) { puts.push([key, contentType]); },
    async getText() { return ''; },
    async move() {},
    async signedReadUrl() { return ''; },
  };
}

describe('prepareCandidateDraft', () => {
  it('extracts, stages the file + text, and returns pre-filled fields', async () => {
    const store = fakeStore();
    const out = await prepareCandidateDraft(
      'org-1',
      { bytes: new Uint8Array([1]), mime: 'application/pdf', filename: 'r.pdf' },
      {
        store,
        extractText: async () => 'FULL RESUME TEXT',
        extractFields: async () => ({
          full_name: 'Ada', email: null, phone: null, current_title: null, location: null,
        }),
        newId: () => 'draft-123',
      },
    );
    expect(out.draft_id).toBe('draft-123');
    expect(out.fields.full_name).toBe('Ada');
    expect(out.preview).toContain('FULL RESUME TEXT');
    expect(store.puts).toContainEqual([stagingKey('org-1', 'draft-123'), 'application/pdf']);
    expect(store.puts).toContainEqual([stagingTextKey('org-1', 'draft-123'), 'text/plain']);
  });

  it('propagates extractor errors without staging anything', async () => {
    const store = fakeStore();
    await expect(prepareCandidateDraft(
      'org-1',
      { bytes: new Uint8Array([1]), mime: 'application/pdf', filename: 'r.pdf' },
      { store, extractText: async () => { throw new Error('bad pdf'); },
        extractFields: async () => ({ full_name: null, email: null, phone: null,
          current_title: null, location: null }), newId: () => 'd' },
    )).rejects.toThrow('bad pdf');
    expect(store.puts).toHaveLength(0);
  });
});
