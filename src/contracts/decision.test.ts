import { describe, it, expect } from 'vitest';
import {
  AGENTS, ACTION_CLASSES, DECISION_STATES, TIERS, DecisionProposalSchema, MONEY_ACTION_CLASSES,
  ROLES, canActOnTier, isRiskTier, isAutoApprovedTier,
} from './decision';

const validProposal = {
  org_id: '018f3d70-0000-7000-8000-000000000001',
  agent: 'screening',
  action_class: 'screen.score_resume',
  reasoning: {
    summary: 'Strong match on must-haves',
    evidence: ['8 yrs React', 'AWS cert'],
    model: 'gemini-2.5-flash',
    prompt_version: 'v2.2.0',
  },
  payload: { fit_rating: 'yes', weighted_score: 0.87 },
};

describe('contract constants', () => {
  it('has 13 agents', () => expect(AGENTS).toHaveLength(13));
  it('has 4 tiers', () => expect(TIERS).toEqual(['1', '2', '3', 'risk']));
  it('has 7 states', () => expect(DECISION_STATES).toHaveLength(7));
  it('maps every money action class to tier 3', () => {
    expect(ACTION_CLASSES['placement.assemble_offer']).toBe('3');
    expect(ACTION_CLASSES['bd.send_proposal']).toBe('3');
    expect(ACTION_CLASSES['placement.trigger_invoice']).toBe('3');
  });
  it('flags exactly the three money action classes as non-graduatable', () => {
    expect(MONEY_ACTION_CLASSES).toEqual([
      'placement.assemble_offer', 'bd.send_proposal', 'placement.trigger_invoice',
    ]);
  });
});

describe('canActOnTier', () => {
  it('admin can act on every tier', () => {
    for (const tier of TIERS) expect(canActOnTier('admin', tier)).toBe(true);
  });

  it('recruiter can act on tier 1 and 2 but not tier 3 or risk', () => {
    expect(canActOnTier('recruiter', '1')).toBe(true);
    expect(canActOnTier('recruiter', '2')).toBe(true);
    expect(canActOnTier('recruiter', '3')).toBe(false);
    expect(canActOnTier('recruiter', 'risk')).toBe(false);
  });
});

describe('isRiskTier', () => {
  it('is true only for risk', () => {
    expect(isRiskTier('risk')).toBe(true);
    for (const tier of ['1', '2', '3']) expect(isRiskTier(tier)).toBe(false);
  });
});

describe('isAutoApprovedTier', () => {
  it('is true for tier 1 and 2, false for tier 3 and risk', () => {
    expect(isAutoApprovedTier('1')).toBe(true);
    expect(isAutoApprovedTier('2')).toBe(true);
    expect(isAutoApprovedTier('3')).toBe(false);
    expect(isAutoApprovedTier('risk')).toBe(false);
  });
});

describe('DecisionProposalSchema', () => {
  it('accepts a valid proposal and defaults optional refs to null', () => {
    const parsed = DecisionProposalSchema.parse(validProposal);
    expect(parsed.job_order_id).toBeNull();
    expect(parsed.payload).toEqual(validProposal.payload);
  });

  it('rejects an unknown action_class', () => {
    const result = DecisionProposalSchema.safeParse({ ...validProposal, action_class: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects a proposal without reasoning.summary', () => {
    const bad = { ...validProposal, reasoning: { ...validProposal.reasoning, summary: '' } };
    const result = DecisionProposalSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toContain('summary');
  });

  it('rejects a tier field — agents never set tier', () => {
    const result = DecisionProposalSchema.safeParse({ ...validProposal, tier: '1' });
    expect(result.success).toBe(false);
  });
});
