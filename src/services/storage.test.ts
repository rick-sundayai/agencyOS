import { describe, it, expect, vi } from 'vitest';
import { makeGcsStore, type BucketLike } from './storage';

function fakeBucket() {
  const save = vi.fn(async () => {});
  const download = vi.fn(async () => [Buffer.from('staged text')]);
  const copy = vi.fn(async () => {});
  const del = vi.fn(async () => {});
  const getSignedUrl = vi.fn(async () => ['https://signed.example/x']);
  const file = vi.fn((key: string) => ({ save, download, copy, delete: del, getSignedUrl, name: key }));
  return { bucket: { file } as unknown as BucketLike, save, download, copy, del, getSignedUrl, file };
}

describe('makeGcsStore', () => {
  it('put() saves bytes with the content type', async () => {
    const f = fakeBucket();
    await makeGcsStore(f.bucket).put('staging/o/d', new Uint8Array([1]), 'application/pdf');
    expect(f.file).toHaveBeenCalledWith('staging/o/d');
    expect(f.save).toHaveBeenCalledWith(expect.any(Buffer),
      { contentType: 'application/pdf', resumable: false });
  });

  it('getText() downloads and returns UTF-8', async () => {
    const f = fakeBucket();
    expect(await makeGcsStore(f.bucket).getText('staging/o/d.txt')).toBe('staged text');
  });

  it('move() copies to the destination then deletes the source', async () => {
    const f = fakeBucket();
    await makeGcsStore(f.bucket).move('staging/o/d', 'resumes/o/c/doc');
    expect(f.copy).toHaveBeenCalled();
    expect(f.del).toHaveBeenCalled();
  });
});
