export type EmbedFn = (text: string) => Promise<number[]>;

const MODEL = 'gemini-embedding-001';
const DIM = 3072; // must match the embeddings table + HNSW index

export function makeGeminiApiEmbedder(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): EmbedFn {
  return async (text: string) => {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: DIM,
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini embed failed: ${res.status}`);
    return (await res.json()).embedding.values as number[];
  };
}

export function makeVertexEmbedder(opts: {
  project: string;
  location: string;
  tokenFn: () => Promise<string>;
  fetchFn?: typeof fetch;
}): EmbedFn {
  const fetchFn = opts.fetchFn ?? fetch;
  const url =
    `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.project}` +
    `/locations/${opts.location}/publishers/google/models/${MODEL}:predict`;
  return async (text: string) => {
    const token = await opts.tokenFn();
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        instances: [{ content: text }],
        parameters: { outputDimensionality: DIM },
      }),
    });
    if (!res.ok) throw new Error(`vertex embed failed: ${res.status}`);
    return (await res.json()).predictions[0].embeddings.values as number[];
  };
}

export function defaultEmbedder(): EmbedFn {
  const project = process.env.VERTEX_PROJECT;
  if (project) {
    const location = process.env.VERTEX_LOCATION ?? 'us-central1';
    return makeVertexEmbedder({
      project,
      location,
      tokenFn: async () => {
        const { GoogleAuth } = await import('google-auth-library');
        const auth = new GoogleAuth({
          scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });
        const token = await auth.getAccessToken();
        if (!token) throw new Error('vertex embed: no ADC access token');
        return token;
      },
    });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) return makeGeminiApiEmbedder(apiKey);
  throw new Error('embeddings: set VERTEX_PROJECT (prod) or GEMINI_API_KEY (dev)');
}
