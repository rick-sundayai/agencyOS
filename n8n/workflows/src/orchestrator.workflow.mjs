import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Signal In', 'signal');

const route = code('Route Signal', 'orchestrator', `
const b = $json.body ?? $json;
const { org_id, type, payload = {} } = b;
if (!org_id || !type) throw new Error('signal requires org_id and type');

if (type === 'job_order.created') {
  if (!payload.job_order_id) throw new Error('job_order.created requires payload.job_order_id');
  await http({ method: 'POST', url: 'http://localhost:5678/webhook/source',
    body: { org_id, job_order_id: payload.job_order_id }, json: true });
  return [{ json: { routed: 'sourcing' } }];
}

if (type === 'candidate.ingested') {
  // No downstream consumer in Phase 1 — acknowledged for the audit trail.
  return [{ json: { routed: 'none' } }];
}

await proposeDecision({
  org_id, agent: 'orchestrator', action_class: 'risk.alert',
  reasoning: {
    summary: 'Unrecognized signal type: ' + type,
    evidence: [JSON.stringify(payload).slice(0, 500)],
    model: 'deterministic', prompt_version: 'orchestrator-v1',
  },
  payload: { signal_type: type },
});
return [{ json: { routed: 'risk' } }];
`);

export default workflow('agencyos-orchestrator', 'AgencyOS Orchestrator', [trigger, route]);
