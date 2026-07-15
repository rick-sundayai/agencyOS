// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../app/queue-actions', () => ({
  approveDecisionAction: vi.fn().mockResolvedValue(undefined),
  cancelDecisionAction: vi.fn().mockResolvedValue(undefined),
}));

import { approveDecisionAction, cancelDecisionAction } from '../app/queue-actions';
import { DecisionCard } from './DecisionCard';
import type { QueueDecision } from './queue-types';

const base: QueueDecision = {
  id: 'd-1',
  org_id: 'o-1',
  agent: 'placement',
  action_class: 'client.submit_candidate',
  tier: '3',
  state: 'proposed',
  reasoning: { summary: 'Strong fit for the role', evidence: ['8 yrs React'], model: 'claude', prompt_version: 'v1' },
  payload: { note: 'x' },
  job_order_id: null,
  candidate_id: null,
  client_id: null,
  undo_expires_at: null,
  approved_by: null,
  cancelled_by: null,
  cancelled_at: null,
  error: null,
  outcome: null,
  proposed_at: new Date().toISOString(),
  decided_at: null,
  executed_at: null,
};

describe('DecisionCard', () => {
  it('shows action class, agent, and reasoning summary', () => {
    render(<DecisionCard decision={base} />);
    expect(screen.getByText('client.submit_candidate')).toBeDefined();
    expect(screen.getByText('placement')).toBeDefined();
    expect(screen.getByText('Strong fit for the role')).toBeDefined();
  });

  it('approve calls the action with the decision id', async () => {
    const onResolved = vi.fn();
    render(<DecisionCard decision={base} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveDecisionAction).toHaveBeenCalledWith('d-1'));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('d-1'));
  });

  it('risk cards show Resolve and no Approve', () => {
    render(<DecisionCard decision={{ ...base, tier: 'risk', action_class: 'risk.alert' }} />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDefined();
  });

  it('undo-window cards show a countdown and an Undo button', async () => {
    const tier2: QueueDecision = {
      ...base,
      tier: '2',
      state: 'approved',
      action_class: 'comms.candidate_outreach',
      undo_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    render(<DecisionCard decision={tier2} />);
    expect(screen.getByText(/Executes in \d+s unless cancelled/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(cancelDecisionAction).toHaveBeenCalledWith('d-1'));
  });
});
