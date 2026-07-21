import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Source In', 'source');

const source = code('Build Shortlist', 'sourcing', `
const b = $json.body ?? $json;
const { org_id, job_order_id, sourcing_run_id = null } = b;
if (!org_id || !job_order_id) throw new Error('source requires org_id and job_order_id');

try {
  await updateRun(sourcing_run_id, { phase: 'searching_pool' });

  const { job_order: job } = await apiGet('/api/agent/job-orders/' + job_order_id, { org_id });
  const jobText = [
    job.title,
    job.description ?? '',
    'Must have: ' + JSON.stringify(job.must_haves ?? []),
    'Nice to have: ' + JSON.stringify(job.nice_to_haves ?? []),
  ].join('\\n');

  // Reuse the stored job embedding when the text is unchanged; embed + store otherwise.
  const jobHash = sha256(jobText);
  const { chunks: stored } = await apiGet('/api/agent/embeddings',
    { subject_type: 'job_order', subject_id: job_order_id });
  let queryEmbedding;
  if (stored.length > 0 && stored[0].content_hash === jobHash) {
    queryEmbedding = stored[0].embedding;
  } else {
    queryEmbedding = await embed(jobText);
    await apiPost('/api/agent/embeddings', {
      org_id, subject_type: 'job_order', subject_id: job_order_id,
      chunks: [{ chunk_index: 0, content: jobText, embedding: queryEmbedding, content_hash: jobHash }],
    });
    await apiPost('/api/agent/runs', {
      org_id, agent: 'sourcing', workflow: 'agencyos-sourcing',
      model: 'gemini-embedding-001', prompt_version: null,
      tokens_in: null, tokens_out: null, status: 'succeeded', decision_id: null,
    });
  }

  const search = () => apiPost('/api/agent/search/candidates', {
    org_id, query_embedding: queryEmbedding, limit: 10,
  });
  let { results } = await search();
  await updateRun(sourcing_run_id, { stats: { pool_matches: results.length } });

  // Thin check: only reach for JobDiva when the internal pool can't cover the job.
  const good = results.filter((r) => Number(r.distance) < MAX_DISTANCE);
  let jobdivaUsed = false;
  if (good.length < MIN_GOOD_MATCHES) {
    await updateRun(sourcing_run_id, { phase: 'checking_jobdiva' });
    try {
      await apiPost('/api/agent/jobdiva/import-candidates', { job_order_id, sourcing_run_id });
      jobdivaUsed = true;
      ({ results } = await search());
    } catch (e) {
      // Soft failure: a thin shortlist beats no shortlist. Recorded for the panel.
      await updateRun(sourcing_run_id, {
        stats: { jobdiva_error: String((e && e.message) || e).slice(0, 300) },
      });
    }
  }

  await updateRun(sourcing_run_id, { phase: 'shortlisting', stats: { shortlisted: results.length } });

  const d = await proposeDecision({
    org_id, agent: 'sourcing', action_class: 'source.shortlist',
    reasoning: {
      summary: 'Shortlisted ' + results.length + ' candidates for "' + job.title + '" by vector similarity'
        + (jobdivaUsed ? ' (pool was thin — pulled fresh candidates from JobDiva)' : ' over the internal pool'),
      evidence: results.map((r) => r.full_name + ': distance ' + Number(r.distance).toFixed(4)),
      model: 'gemini-embedding-001', prompt_version: 'sourcing-v1',
    },
    payload: { candidate_ids: results.map((r) => r.candidate_id), ranked: results },
    job_order_id,
  });
  await completeDecision(d.decision.id, { shortlisted: results.length });

  if (results.length > 0) {
    await apiPost('/api/agent/applications', {
      job_order_id, candidate_ids: results.map((r) => r.candidate_id),
    });
    await updateRun(sourcing_run_id, { phase: 'screening' });
    await http({ method: 'POST', url: 'http://localhost:5678/webhook/screen',
      body: { org_id, job_order_id, candidate_ids: results.map((r) => r.candidate_id) }, json: true });
  }

  await updateRun(sourcing_run_id, { phase: 'done' });
  return [{ json: { shortlisted: results.length } }];
} catch (err) {
  await updateRun(sourcing_run_id, {
    phase: 'failed', error: String((err && err.message) || err).slice(0, 500),
  });
  throw err;
}
`);

export default workflow('agencyos-sourcing', 'AgencyOS Sourcing', [trigger, source]);
