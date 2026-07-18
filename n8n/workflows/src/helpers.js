// ---- AgencyOS Code-node helpers (prepended by n8n/build.mjs) ----
// Requires: const WORKFLOW_AGENT = '<agent>'; injected above this block by the builder.
const http = (o) => this.helpers.httpRequest(o);
const API = $env.AGENCY_API_URL;
const HEADERS = { 'x-agent-api-key': $env.AGENT_API_KEY };
const apiGet = (path, qs) => http({ method: 'GET', url: API + path, headers: HEADERS, qs, json: true });
const apiPost = (path, body) => http({ method: 'POST', url: API + path, headers: HEADERS, body, json: true });

const geminiPost = (model, action, body) => http({
  method: 'POST',
  url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`,
  headers: { 'x-goog-api-key': $env.GEMINI_API_KEY },
  body, json: true,
});
const embed = async (text) => (await geminiPost('gemini-embedding-001', 'embedContent', {
  model: 'models/gemini-embedding-001',
  content: { parts: [{ text }] },
  outputDimensionality: 3072,
})).embedding.values;
const generateJson = (model, system, user, temperature = 0.1) => geminiPost(model, 'generateContent', {
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: user }] }],
  generationConfig: { temperature, responseMimeType: 'application/json' },
});

const proposeDecision = (p) => apiPost('/api/agent/decisions', p);
const transition = (id, to, extras = {}) =>
  apiPost(`/api/agent/decisions/${id}/transition`, { to, actor: WORKFLOW_AGENT, ...extras });
const completeDecision = async (id, outcome) => {
  await transition(id, 'executing');
  return transition(id, 'executed', { outcome });
};

const chunkText = (text, size = 1500, overlap = 200) => {
  const out = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- n8n Code node runs as CommonJS, not bundled
const sha256 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
// ---- end helpers ----
