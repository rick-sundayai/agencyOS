import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Source In', 'source');

const source = code('Build Shortlist', 'sourcing', `
const b = $json.body ?? $json;
const { org_id, job_order_id } = b;
if (!org_id || !job_order_id) throw new Error('source requires org_id and job_order_id');

const { job_order: job } = await apiGet('/api/agent/job-orders/' + job_order_id, { org_id });

const jobText = [
  job.title,
  job.description ?? '',
  'Must have: ' + JSON.stringify(job.must_haves ?? []),
  'Nice to have: ' + JSON.stringify(job.nice_to_haves ?? []),
].join('\\n');
const queryEmbedding = await embed(jobText);
await apiPost('/api/agent/runs', {
  org_id, agent: 'sourcing', workflow: 'agencyos-sourcing',
  model: 'gemini-embedding-001', prompt_version: null,
  tokens_in: null, tokens_out: null, status: 'succeeded', decision_id: null,
});

const { results } = await apiPost('/api/agent/search/candidates', {
  org_id, query_embedding: queryEmbedding, limit: 10,
});

const d = await proposeDecision({
  org_id, agent: 'sourcing', action_class: 'source.shortlist',
  reasoning: {
    summary: 'Shortlisted ' + results.length + ' candidates for "' + job.title + '" by vector similarity over the internal pool',
    evidence: results.map((r) => r.full_name + ': distance ' + Number(r.distance).toFixed(4)),
    model: 'gemini-embedding-001', prompt_version: 'sourcing-v1',
  },
  payload: { candidate_ids: results.map((r) => r.candidate_id), ranked: results },
  job_order_id,
});
await completeDecision(d.decision.id, { shortlisted: results.length });

if (results.length > 0) {
  await http({ method: 'POST', url: 'http://localhost:5678/webhook/screen',
    body: { org_id, job_order_id, candidate_ids: results.map((r) => r.candidate_id) }, json: true });
}
return [{ json: { shortlisted: results.length } }];
`);

export default workflow('agencyos-sourcing', 'AgencyOS Sourcing', [trigger, source]);
