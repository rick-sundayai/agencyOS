import { schedule, code, workflow } from './lib.mjs';

const tick = schedule('Every Minute', 1);

const send = code('Execute Comms Decisions', 'communication', `
const { queue } = await apiGet('/api/agent/decisions/executable', { action_prefix: 'comms.' });
const results = [];

for (const d of queue) {
  // Whole-decision isolation: a lost ADR-0003 race (someone else transitioned this
  // decision between listExecutable and now — surfaced as a 409), a compliance-check
  // network blip, or any other per-decision error must not abort the batch. Without this
  // outer try/catch, one bad decision throws out of the loop and every decision queued
  // after it (listExecutable orders oldest-first) silently doesn't get processed this tick.
  try {
    const p = d.payload ?? {};
    const check = await apiPost('/api/agent/compliance/check', {
      org_id: d.org_id, candidate_id: d.candidate_id, channel: p.channel ?? 'email',
    });

    if (check.verdict === 'defer') {
      results.push({ id: d.id, action: 'deferred', reasons: check.reasons });
      continue; // stays approved; retried next tick
    }

    await transition(d.id, 'executing');

    if (check.verdict === 'deny') {
      await transition(d.id, 'failed', { error: 'compliance_denied: ' + check.reasons.join(',') });
      results.push({ id: d.id, action: 'denied', reasons: check.reasons });
      continue;
    }

    try {
      if (!p.to || !p.subject || !p.body) throw new Error('payload requires to, subject, body');
      await http({ method: 'POST', url: $env.MAIL_API_URL, json: true, body: {
        From: { Email: $env.MAIL_FROM, Name: 'Sunday AI Work Recruiting' },
        To: [{ Email: p.to }],
        Subject: p.subject,
        Text: p.body,
      }});
      const logged = await apiPost('/api/agent/messages', {
        org_id: d.org_id, candidate_id: d.candidate_id, channel: 'email',
        direction: 'outbound', body: 'Subject: ' + p.subject + '\\n\\n' + p.body, decision_id: d.id,
      });
      await transition(d.id, 'executed', { outcome: { message_id: logged.message_id } });
      results.push({ id: d.id, action: 'sent' });
    } catch (err) {
      // Decision is already 'executing' at this point — safe to transition to failed.
      await transition(d.id, 'failed', { error: String((err && err.message) || err) });
      results.push({ id: d.id, action: 'failed' });
    }
  } catch (err) {
    // Failed before or during the move to 'executing' (e.g. the compliance check itself
    // errored, or transition() returned 409 because someone else already resolved this
    // decision). Don't call transition('failed') here — we may not even know the decision
    // is still in a state that accepts it. Just record and move on to the rest of the batch.
    results.push({ id: d.id, action: 'skipped', error: String((err && err.message) || err) });
  }
}
return results.length ? results.map((r) => ({ json: r })) : [{ json: { checked: 0 } }];
`);

export default workflow('agencyos-communication', 'AgencyOS Communication', [tick, send]);
