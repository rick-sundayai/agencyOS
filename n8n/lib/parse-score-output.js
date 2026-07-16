// Ported from the validated Agentic_Recruiter_Match "Parse Score Output" node
// (score-v2.2.0 + C01-hard-gate-v2, ADR-0002 / CAL-0002 baseline 81.3%).
// Pure function: takes the raw Gemini response object, returns the parsed evaluation.
// Inlined into the n8n Screening Code node by n8n/build.mjs — keep it dependency-free.

const WEIGHTS = { C01: 0.15, C02: 0.15, C03: 0.10, C04: 0.10, C05: 0.10, C06: 0.05,
                  C07: 0.05, C08: 0.08, C09: 0.05, C10: 0.05, C11: 0.07, C12: 0.05 };

function parseScoreOutput(raw) {
  // Locate the model's JSON text robustly across node/output shapes.
  const text =
       raw?.candidates?.[0]?.content?.parts?.[0]?.text  // raw REST shape
    ?? raw?.content?.parts?.[0]?.text                   // langchain googleGemini (simplify:false)
    ?? raw?.text                                        // simplified
    ?? (typeof raw?.content === 'string' ? raw.content : null);
  if (!text) {
    throw new Error('parseScoreOutput: could not locate Gemini JSON text in the response');
  }
  const evaluation = JSON.parse(text).evaluation;

  // Model returns either a scored_criteria[] array or a scores{} object — handle both.
  let criteriaArray = [];
  if (Array.isArray(evaluation.scored_criteria)) {
    criteriaArray = evaluation.scored_criteria;
  } else if (evaluation.scores) {
    criteriaArray = Object.entries(evaluation.scores).map(([k, v]) => ({
      id: k.substring(0, 3).toUpperCase(), score: v.score, rationale: v.rationale }));
  }

  const scores = {};
  let weightedScore = 0;
  criteriaArray.forEach((c) => {
    const id = c.id.toUpperCase();
    const w = WEIGHTS[id] || 0;
    scores[id] = { score: c.score, rationale: c.rationale };
    weightedScore += c.score * w;
  });

  const fitPct = parseFloat(((weightedScore / 5.0) * 100).toFixed(1));

  let fitRating =
    fitPct >= 85 ? 'Excellent Fit' :
    fitPct >= 70 ? 'Good Fit' :
    fitPct >= 55 ? 'Moderate Fit' : 'Poor Fit';
  let submittalReady = fitPct >= 70;
  let agentLabel = fitPct >= 70 ? 'yes' : fitPct >= 55 ? 'borderline' : 'no';

  // C01 hard gate :: ADR-0002 (score-v2.2.0 + C01-hard-gate-v2). If Primary Role Keywords
  // Match <= 1, force 'no' regardless of the weighted total. Numeric preserved for diagnosis.
  const c01 = scores.C01 ? scores.C01.score : null;
  const gateFired = c01 !== null && c01 <= 1;
  if (gateFired) {
    fitRating = 'Poor Fit';
    submittalReady = false;
    agentLabel = 'no';
  }

  return {
    scores,
    weighted_score: parseFloat(weightedScore.toFixed(3)),
    fit_percentage: fitPct,
    fit_rating: fitRating,
    agent_label: agentLabel,
    c01_gate_fired: gateFired,
    gate_version: 'C01-hard-gate-v2',
    top_strengths: evaluation.summary?.top_strengths || [],
    key_gaps: evaluation.summary?.key_gaps || [],
    recommendation: evaluation.summary?.recommendation || '',
    submittal_ready: submittalReady,
  };
}

module.exports = { parseScoreOutput, WEIGHTS };
