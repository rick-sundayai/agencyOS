import { webhook, code, workflow } from './lib.mjs';

const trigger = webhook('Screen In', 'screen');

const screen = code('Score Candidates', 'screening', `
const b = $json.body ?? $json;
const { org_id, job_order_id, candidate_ids = [] } = b;
if (!org_id || !job_order_id) throw new Error('screen requires org_id and job_order_id');

const { prompt } = await apiGet('/api/agent/prompts', { org_id, agent: 'screening', name: 'resume-scorer' });
const spec = JSON.parse(prompt.body); // { system, user_template }
const { job_order: job } = await apiGet('/api/agent/job-orders/' + job_order_id, { org_id });

const out = [];
for (const candidate_id of candidate_ids) {
  // Whole-candidate isolation: unlike Communication Agent, Screening runs once per webhook
  // call with no scheduled retry — an uncaught error here (a blocked/malformed Gemini
  // response, a bad draft JSON.parse, a transient API call) would otherwise permanently
  // leave every candidate after this one in the shortlist unscored, with zero visibility.
  try {
    const cr = await apiGet('/api/agent/candidates/' + candidate_id, { org_id });
    const cand = cr.candidate;

    if (!cr.resume || !cr.resume.parsed_text) {
      await proposeDecision({
        org_id, agent: 'screening', action_class: 'risk.alert',
        reasoning: { summary: 'Shortlisted candidate ' + cand.full_name + ' has no resume on file — cannot screen',
          evidence: [], model: 'deterministic', prompt_version: prompt.version },
        payload: { candidate_id, job_order_id }, job_order_id, candidate_id,
      });
      out.push({ candidate_id, fit: 'unscreened' });
      continue;
    }

    // replaceAll, not replace: string .replace() only substitutes the FIRST occurrence.
    // A repeated placeholder in a future prompt version would otherwise reach Gemini
    // as literal unsubstituted text, and the structural golden tests would not catch it.
    const user = spec.user_template
      .replaceAll('{job_title}', job.title)
      .replaceAll('{company_name}', '')
      .replaceAll('{skills}', JSON.stringify(job.must_haves ?? []))
      .replaceAll('{summary_text}', job.description ?? '')
      .replaceAll('{fulltext_excerpt}', JSON.stringify(job.nice_to_haves ?? []))
      .replaceAll('{pay_rate_max}', '')
      .replaceAll('{start_date}', '')
      .replaceAll('{end_date}', '')
      .replaceAll('{resume_text}', cr.resume.parsed_text.slice(0, 30000))
      .replaceAll('{candidate_name}', cand.full_name)
      .replaceAll('{evaluated_at}', new Date().toISOString());

    const resp = await generateJson('gemini-2.5-flash', spec.system, user);
    const parsed = parseScoreOutput(resp);
    const usage = resp.usageMetadata ?? {};

    await apiPost('/api/agent/scores', {
      org_id, job_order_id, candidate_id,
      prompt_version: prompt.version, model: 'gemini-2.5-flash',
      fit_rating: parsed.agent_label, weighted_score: parsed.fit_percentage / 100,
      criteria: parsed,
    });

    const sd = await proposeDecision({
      org_id, agent: 'screening', action_class: 'screen.score_resume',
      reasoning: {
        summary: 'Scored ' + cand.full_name + ' at ' + parsed.fit_percentage + '% (' + parsed.agent_label + ')'
          + (parsed.c01_gate_fired ? ' — C01 hard gate fired' : ''),
        evidence: parsed.top_strengths.concat(parsed.key_gaps),
        model: 'gemini-2.5-flash', prompt_version: prompt.version,
      },
      payload: { fit_rating: parsed.agent_label, weighted_score: parsed.fit_percentage / 100 },
      job_order_id, candidate_id,
    });
    await completeDecision(sd.decision.id, { fit_rating: parsed.agent_label });
    await apiPost('/api/agent/runs', {
      org_id, agent: 'screening', workflow: 'agencyos-screening',
      model: 'gemini-2.5-flash', prompt_version: prompt.version,
      tokens_in: usage.promptTokenCount ?? null, tokens_out: usage.candidatesTokenCount ?? null,
      status: 'succeeded', decision_id: sd.decision.id,
    });

    if (parsed.agent_label === 'yes') {
      if (!cand.email) {
        await proposeDecision({
          org_id, agent: 'screening', action_class: 'risk.alert',
          reasoning: { summary: cand.full_name + ' scored ' + parsed.fit_percentage + '% but has no email on file',
            evidence: parsed.top_strengths, model: 'deterministic', prompt_version: prompt.version },
          payload: { candidate_id, job_order_id }, job_order_id, candidate_id,
        });
      } else {
        const draft = await generateJson('gemini-2.5-flash',
          'You draft short, warm, professional recruiting outreach emails. Return ONLY JSON: {"subject": string, "body": string}. Write a complete, sendable email with no placeholders. Sign off as "the Sunday AI Work recruiting team".',
          'Job: ' + job.title + '\\nCandidate: ' + cand.full_name
            + '\\nWhy they fit: ' + parsed.recommendation
            + '\\nTop strengths: ' + parsed.top_strengths.join('; ')
            + '\\nWrite the outreach email inviting a quick intro call this week.', 0.4);
        const dj = JSON.parse(draft.candidates[0].content.parts[0].text);
        await apiPost('/api/agent/runs', {
          org_id, agent: 'screening', workflow: 'agencyos-screening',
          model: 'gemini-2.5-flash', prompt_version: 'outreach-draft-v1',
          tokens_in: draft.usageMetadata?.promptTokenCount ?? null,
          tokens_out: draft.usageMetadata?.candidatesTokenCount ?? null,
          status: 'succeeded', decision_id: null,
        });
        await proposeDecision({
          org_id, agent: 'screening', action_class: 'comms.candidate_outreach',
          reasoning: {
            summary: 'Outreach draft for ' + cand.full_name + ' — scored ' + parsed.fit_percentage + '% for ' + job.title,
            evidence: parsed.top_strengths, model: 'gemini-2.5-flash', prompt_version: 'outreach-draft-v1',
          },
          payload: { channel: 'email', to: cand.email, subject: dj.subject, body: dj.body, candidate_id },
          job_order_id, candidate_id,
        }); // tier 2 → auto-approved with an undo window; Communication Agent executes after expiry
      }
    } else if (parsed.agent_label === 'borderline') {
      await proposeDecision({
        org_id, agent: 'screening', action_class: 'risk.alert',
        reasoning: {
          summary: 'Borderline screen for ' + cand.full_name + ' (' + parsed.fit_percentage + '%) — needs human review',
          evidence: parsed.key_gaps, model: 'gemini-2.5-flash', prompt_version: prompt.version,
        },
        payload: { candidate_id, job_order_id, fit_percentage: parsed.fit_percentage },
        job_order_id, candidate_id,
      });
    }
    out.push({ candidate_id, fit: parsed.agent_label });
  } catch (err) {
    // Surface it, don't just swallow it — same visibility pattern as the "no resume" /
    // "no email" branches above, so a recruiter sees this candidate needs a human look
    // instead of it silently vanishing from the shortlist's results.
    await proposeDecision({
      org_id, agent: 'screening', action_class: 'risk.alert',
      reasoning: {
        summary: 'Screening failed for candidate ' + candidate_id + ': ' + String((err && err.message) || err),
        evidence: [], model: 'deterministic', prompt_version: prompt.version,
      },
      payload: { candidate_id, job_order_id }, job_order_id, candidate_id,
    });
    out.push({ candidate_id, fit: 'error' });
  }
}
return out.length ? out.map((o) => ({ json: o })) : [{ json: { screened: 0 } }];
`, { withParser: true });

export default workflow('agencyos-screening', 'AgencyOS Screening', [trigger, screen]);
