import { describe, it, expect, vi } from 'vitest';
import { makeGeminiApiEmbedder, makeVertexEmbedder } from './embed';

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

describe('makeGeminiApiEmbedder', () => {
  it('calls the Gemini API with the key header and returns the vector', async () => {
    const fetchFn = vi.fn(async () => okJson({ embedding: { values: [0.1, 0.2] } }));
    const embed = makeGeminiApiEmbedder('test-key', fetchFn as unknown as typeof fetch);
    const vec = await embed('hello');
    expect(vec).toEqual([0.1, 0.2]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-embedding-001:embedContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.outputDimensionality).toBe(3072);
    expect(body.content.parts[0].text).toBe('hello');
  });

  it('throws on a non-OK response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429 }) as Response);
    const embed = makeGeminiApiEmbedder('k', fetchFn as unknown as typeof fetch);
    await expect(embed('x')).rejects.toThrow('embed failed: 429');
  });
});

describe('makeVertexEmbedder', () => {
  it('calls the Vertex predict endpoint with a bearer token and returns the vector', async () => {
    const fetchFn = vi.fn(async () =>
      okJson({ predictions: [{ embeddings: { values: [0.3, 0.4] } }] }),
    );
    const embed = makeVertexEmbedder({
      project: 'client-a',
      location: 'us-central1',
      tokenFn: async () => 'tok-123',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const vec = await embed('hello');
    expect(vec).toEqual([0.3, 0.4]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/client-a/locations/us-central1/publishers/google/models/gemini-embedding-001:predict',
    );
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok-123');
    const body = JSON.parse(init.body as string);
    expect(body.instances[0].content).toBe('hello');
    expect(body.parameters.outputDimensionality).toBe(3072);
  });

  it('throws on a non-OK response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 403 }) as Response);
    const embed = makeVertexEmbedder({
      project: 'p', location: 'us-central1',
      tokenFn: async () => 't', fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(embed('x')).rejects.toThrow('embed failed: 403');
  });
});
