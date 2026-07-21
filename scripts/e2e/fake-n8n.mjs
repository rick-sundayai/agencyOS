// Stub for e2e runs: plays n8n (drives a sourcing run through its phases via the real
// agent API) and JobDiva (auth + getJob). Port 5679. Not used outside `npm run test:e2e`.
import http from 'node:http';

const API = process.env.AGENCY_API_URL ?? 'http://localhost:3000';
const KEY = process.env.AGENT_API_KEY ?? 'dev-agent-key-change-me';
const HEADERS = { 'content-type': 'application/json', 'x-agent-api-key': KEY };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apiPost = (path, body) =>
  fetch(API + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }).then((r) => r.json());
const apiPatch = (path, body) =>
  fetch(API + path, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(body) }).then((r) => r.json());

async function driveSourcingRun({ org_id, job_order_id, sourcing_run_id }) {
  const patch = (p) => apiPatch(`/api/agent/sourcing-runs/${sourcing_run_id}`, p);
  await patch({ phase: 'searching_pool' });
  await sleep(300);
  await patch({ phase: 'checking_jobdiva', stats: { pool_matches: 2 } });
  await sleep(300);
  await patch({ phase: 'embedding_new', stats: { jobdiva_found: 3, embedded: 2 } });

  // Two fresh candidates via the real ingest endpoint, so the shortlist links resolve.
  // CandidateIngestSchema (src/services/ingest.ts) is a strictObject — org_id comes from
  // the agent-key auth, not the body, so only full_name/email/source belong here.
  const suffix = Date.now();
  const c1 = await apiPost('/api/agent/candidates', {
    full_name: `E2E Ada ${suffix}`, email: `ada-${suffix}@e2e.test`, source: 'jobdiva',
  });
  const c2 = await apiPost('/api/agent/candidates', {
    full_name: `E2E Grace ${suffix}`, email: `grace-${suffix}@e2e.test`, source: 'jobdiva',
  });
  // ingestCandidate() returns { candidate_id, document_id, deduped } directly (no wrapper).
  const ranked = [c1, c2].map((c, i) => ({
    candidate_id: c.candidate_id, full_name: i === 0 ? `E2E Ada ${suffix}` : `E2E Grace ${suffix}`,
    current_title: 'Engineer', distance: 0.3 + i * 0.05,
  }));

  await patch({ phase: 'shortlisting', stats: { shortlisted: ranked.length } });
  // proposeDecision (src/services/decision-store.ts) auto-approves Tier-1 action classes —
  // 'source.shortlist' is Tier 1 (src/contracts/decision.ts ACTION_CLASSES), so this
  // decision is created directly in state 'approved', not 'proposed'.
  const d = await apiPost('/api/agent/decisions', {
    agent: 'sourcing', action_class: 'source.shortlist',
    reasoning: { summary: 'e2e shortlist', evidence: [], model: 'e2e', prompt_version: 'e2e-v1' },
    payload: { candidate_ids: ranked.map((r) => r.candidate_id), ranked },
    job_order_id,
  });
  // TransitionBodySchema (src/app/api/agent/decisions/[id]/transition/route.ts) is a
  // strictObject of { to, error?, outcome? } — no 'actor' field; the actor is derived
  // server-side from the agent-key identity. approved -> executing -> executed is the
  // only valid path (src/contracts/transitions.ts), and getSourcingShortlist()
  // (src/services/sourcing-runs.ts) reads the latest decision where
  // action_class = 'source.shortlist' AND state = 'executed', which this lands on.
  await apiPost(`/api/agent/decisions/${d.decision.id}/transition`, { to: 'executing' });
  await apiPost(`/api/agent/decisions/${d.decision.id}/transition`, { to: 'executed', outcome: {} });
  await apiPost('/api/agent/applications', {
    job_order_id, candidate_ids: ranked.map((r) => r.candidate_id),
  });
  await patch({ phase: 'done' });
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://localhost:5679');

    if (url.pathname === '/webhook/source') {
      res.writeHead(200).end('{}');
      const body = JSON.parse(raw || '{}');
      driveSourcingRun(body).catch((err) => console.error('fake-n8n drive failed:', err));
      return;
    }
    // JobDiva stub — paths mirror ENDPOINTS in src/services/jobdiva.ts under /jobdiva.
    if (url.pathname === '/jobdiva/api/authenticate') {
      res.writeHead(200).end('fake-token');
      return;
    }
    if (url.pathname === '/jobdiva/apiv2/jobdiva/getJobById') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{
        title: 'Imported: Platform Engineer', description: 'From the JobDiva stub',
        skills: ['Kubernetes', 'Go'], jobType: 'Contract',
      }]));
      return;
    }
    res.writeHead(404).end('not found');
  });
});

server.listen(5679, () => console.log('fake-n8n listening on :5679'));
