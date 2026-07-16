import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { parseScoreOutput } from './parse-score-output.js';

const IDS = ['C01','C02','C03','C04','C05','C06','C07','C08','C09','C10','C11','C12'];

function geminiResponse(scoresById: Record<string, number>) {
  const scored_criteria = IDS.map((id) => ({ id, score: scoresById[id] ?? 4, rationale: 'evidence' }));
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      evaluation: { scored_criteria, summary: { top_strengths: ['s1'], key_gaps: ['g1'], recommendation: 'rec' } },
    }) }] } }],
    modelVersion: 'gemini-2.5-flash',
  };
}

describe('parseScoreOutput', () => {
  it('computes weighted score, percentage, and labels (all 4s → 80% → yes)', () => {
    const r = parseScoreOutput(geminiResponse({}));
    expect(r.weighted_score).toBeCloseTo(4.0, 3);
    expect(r.fit_percentage).toBe(80);
    expect(r.agent_label).toBe('yes');
    expect(r.fit_rating).toBe('Good Fit');
    expect(r.submittal_ready).toBe(true);
    expect(r.c01_gate_fired).toBe(false);
  });

  it('fires the C01 hard gate: C01=1 forces no despite a high total', () => {
    const all5s = Object.fromEntries(IDS.map((id) => [id, 5]));
    const r = parseScoreOutput(geminiResponse({ ...all5s, C01: 1 }));
    expect(r.c01_gate_fired).toBe(true);
    expect(r.agent_label).toBe('no');
    expect(r.submittal_ready).toBe(false);
    expect(r.fit_percentage).toBeGreaterThan(80); // numeric preserved for diagnosis
  });

  it('borderline band: ~60% → borderline', () => {
    const all3s = Object.fromEntries(IDS.map((id) => [id, 3]));
    const r = parseScoreOutput(geminiResponse(all3s));
    expect(r.fit_percentage).toBe(60);
    expect(r.agent_label).toBe('borderline');
  });

  it('throws when no model text can be located', () => {
    expect(() => parseScoreOutput({ nope: true })).toThrow(/could not locate/);
  });
});
