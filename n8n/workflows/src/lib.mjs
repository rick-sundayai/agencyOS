// Declares n8n workflows as data. Linear chains only (trigger → code [→ code]).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const HELPERS = readFileSync(resolve('n8n/workflows/src/helpers.js'), 'utf8');
const PARSE_LIB = readFileSync(resolve('n8n/lib/parse-score-output.js'), 'utf8')
  .replace(/module\.exports[\s\S]*$/, ''); // strip CommonJS export for inlining

let n = 0;
const pos = () => [260 * ++n, 0];
const nid = (name) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${n}`;

// Deterministic UUID-shaped string derived from a seed, so rebuilds don't churn the value.
// n8n's Webhook node sets `isFullPath: true` in its description, but the production URL only
// registers at the plain `path` (rather than `${workflowId}/${nodeName}/${path}`) when the node
// carries a `webhookId` — verified against a running n8n 2.6.4 instance (Task 7 build-time check).
const webhookIdFrom = (seed) => {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export function webhook(name, path) {
  const id = nid(name);
  return { id, name, type: 'n8n-nodes-base.webhook', typeVersion: 2, position: pos(),
    webhookId: webhookIdFrom(id),
    parameters: { httpMethod: 'POST', path, responseMode: 'onReceived' } };
}

export function schedule(name, minutes) {
  return { id: nid(name), name, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: pos(),
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: minutes }] } } };
}

export function code(name, agent, jsCode, { withParser = false } = {}) {
  const prelude = `const WORKFLOW_AGENT = '${agent}';\n${HELPERS}\n${withParser ? PARSE_LIB + '\n' : ''}`;
  return { id: nid(name), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(),
    parameters: { mode: 'runOnceForAllItems', jsCode: prelude + jsCode } };
}

export function workflow(wfId, name, nodes) {
  const connections = {};
  for (let i = 0; i < nodes.length - 1; i++) {
    connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
  }
  return { id: wfId, name, active: true, nodes, connections, settings: { executionOrder: 'v1' } };
}
