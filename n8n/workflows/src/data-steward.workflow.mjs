import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Ingest In', 'ingest-candidate');

const ingest = code('Ingest Candidate', 'data-steward', `
const b = $json.body ?? $json;
const { org_id, candidate = {}, resume_text = null } = b;
if (!org_id || !candidate.full_name) throw new Error('ingest requires org_id and candidate.full_name');

const ing = await apiPost('/api/agent/candidates', { org_id, ...candidate, resume_text });

const d = await proposeDecision({
  org_id, agent: 'data-steward', action_class: 'data.enrich_record',
  reasoning: {
    summary: 'Ingested candidate ' + candidate.full_name + (ing.deduped ? ' (deduped into existing record)' : ' (new record)'),
    evidence: [], model: 'deterministic', prompt_version: 'steward-v1',
  },
  payload: { candidate_id: ing.candidate_id },
  candidate_id: ing.candidate_id,
});
await completeDecision(d.decision.id, {
  candidate_id: ing.candidate_id, document_id: ing.document_id, deduped: ing.deduped,
});

if (resume_text && ing.document_id) {
  const chunks = chunkText(resume_text);
  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    rows.push({
      chunk_index: i, content: chunks[i],
      embedding: await embed(chunks[i]),
      content_hash: sha256(chunks[i]),
    });
  }
  await apiPost('/api/agent/embeddings', {
    org_id, subject_type: 'candidate_document', subject_id: ing.document_id, chunks: rows,
  });
  await apiPost('/api/agent/runs', {
    org_id, agent: 'data-steward', workflow: 'agencyos-data-steward',
    model: 'gemini-embedding-001', prompt_version: null,
    tokens_in: null, tokens_out: null, status: 'succeeded', decision_id: d.decision.id,
  });
}

await http({ method: 'POST', url: 'http://localhost:5678/webhook/signal',
  body: { org_id, type: 'candidate.ingested', payload: { candidate_id: ing.candidate_id } }, json: true });

return [{ json: { candidate_id: ing.candidate_id, deduped: ing.deduped } }];
`);

export default workflow('agencyos-data-steward', 'AgencyOS Data Steward', [trigger, ingest]);
