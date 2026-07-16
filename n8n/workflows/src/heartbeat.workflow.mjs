import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Ping', 'ping');
const pong = code('Pong', 'orchestrator', `
return [{ json: { ok: true, at: new Date().toISOString() } }];
`);

export default workflow('agencyos-heartbeat', 'AgencyOS Heartbeat', [trigger, pong]);
