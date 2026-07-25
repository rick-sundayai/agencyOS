export type ObjectStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getText(key: string): Promise<string>;
  move(fromKey: string, toKey: string): Promise<void>;
  signedReadUrl(key: string, downloadName?: string): Promise<string>;
};

// Minimal surface of a @google-cloud/storage Bucket that this adapter uses.
export type FileLike = {
  name: string;
  save(data: Buffer, opts: { contentType: string; resumable: boolean }): Promise<unknown>;
  download(): Promise<[Buffer]>;
  copy(dest: FileLike): Promise<unknown>;
  delete(): Promise<unknown>;
  getSignedUrl(opts: Record<string, unknown>): Promise<[string]>;
};
export type BucketLike = { file(key: string): FileLike };

export function makeGcsStore(bucket: BucketLike): ObjectStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.file(key).save(Buffer.from(bytes), { contentType, resumable: false });
    },
    async getText(key) {
      const [buf] = await bucket.file(key).download();
      return buf.toString('utf-8');
    },
    async move(fromKey, toKey) {
      const src = bucket.file(fromKey);
      await src.copy(bucket.file(toKey));
      await src.delete();
    },
    async signedReadUrl(key, downloadName) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000,
        ...(downloadName
          ? { responseDisposition: `attachment; filename="${downloadName}"` }
          : {}),
      });
      return url;
    },
  };
}

export function defaultStore(): ObjectStore {
  const name = process.env.GCS_RESUME_BUCKET;
  if (!name) throw new Error('storage: set GCS_RESUME_BUCKET');
  // Lazy import so the SDK never enters a client bundle (mirrors embed.ts).
  // ADC provides credentials on Cloud Run, matching how embed.ts's Vertex path authenticates.
  let bucketPromise: Promise<BucketLike> | null = null;
  const getBucket = () => (bucketPromise ??= (async () => {
    const { Storage } = await import('@google-cloud/storage');
    return new Storage().bucket(name) as unknown as BucketLike;
  })());
  return {
    async put(k, b, c) { return makeGcsStore(await getBucket()).put(k, b, c); },
    async getText(k) { return makeGcsStore(await getBucket()).getText(k); },
    async move(f, t) { return makeGcsStore(await getBucket()).move(f, t); },
    async signedReadUrl(k, d) { return makeGcsStore(await getBucket()).signedReadUrl(k, d); },
  };
}
