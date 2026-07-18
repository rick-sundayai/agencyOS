// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import type { QueueDecision } from './queue-types';

// QueueLive renders DecisionCard, which imports the real queue-actions -> lib/auth ->
// next-auth -> next/server chain. That resolves fine in Next's own build but not under
// Vitest/jsdom's on-the-fly ESM resolution — and it's irrelevant here since this file only
// tests QueueLive's SSE connection-health state, not action-calling (that's DecisionCard's
// own test file's job).
vi.mock('../app/queue-actions', () => ({
  approveDecisionAction: vi.fn().mockResolvedValue(undefined),
  cancelDecisionAction: vi.fn().mockResolvedValue(undefined),
}));

import { QueueLive } from './QueueLive';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { MockEventSource.instances.push(this); }
  close() {}
}

beforeEach(() => {
  MockEventSource.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).EventSource = MockEventSource;
});

describe('QueueLive connection health', () => {
  it('shows no banner while connected', () => {
    render(<QueueLive initial={[]} />);
    expect(screen.queryByText(/Live updates interrupted/)).toBeNull();
  });

  it('shows a reconnect banner when the stream errors', () => {
    render(<QueueLive initial={[]} />);
    // React 19 schedules the onerror-triggered state update outside of any batch RTL is
    // watching, so the update must be wrapped in act() (rather than called bare, as a real
    // browser's EventSource callback would be) for the DOM assertion below to see it.
    act(() => {
      MockEventSource.instances[0].onerror?.();
    });
    expect(screen.getByText(/Live updates interrupted/)).toBeDefined();
  });

  it('clears the banner once the stream reopens', () => {
    render(<QueueLive initial={[]} />);
    const es = MockEventSource.instances[0];
    act(() => {
      es.onerror?.();
    });
    expect(screen.getByText(/Live updates interrupted/)).toBeDefined();
    act(() => {
      es.onopen?.();
    });
    expect(screen.queryByText(/Live updates interrupted/)).toBeNull();
  });
});

const decision: QueueDecision = {
  id: 'd-1',
  org_id: 'o-1',
  agent: 'placement',
  action_class: 'client.submit_candidate',
  tier: '3',
  state: 'proposed',
  reasoning: {
    summary: 'Strong fit — ready to submit',
    evidence: [
      { text: '8 yrs React at Acme', source: { label: 'LinkedIn', url: 'https://example.com/p' } },
      { text: 'Likely open to relocation', inferred: true },
    ],
    model: 'claude',
    prompt_version: 'v1',
  },
  payload: { note: 'submit' },
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

describe('QueueLive Drawer', () => {
  it('opens the Drawer on a Decision, shows evidence distinguished by provenance, and closes', () => {
    render(<QueueLive initial={[decision]} />);

    // Drawer is closed initially — no dialog.
    expect(screen.queryByRole('dialog')).toBeNull();

    // Clicking the Decision (its summary) opens the Drawer in place, without leaving the queue.
    fireEvent.click(screen.getByRole('button', { name: 'Strong fit — ready to submit' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toBeDefined();

    // Evidence is visible; sourced evidence carries a link, inferred evidence is marked.
    expect(screen.getByText('8 yrs React at Acme')).toBeDefined();
    expect(screen.getByRole('link', { name: 'LinkedIn' })).toBeDefined();
    expect(screen.getByText('Likely open to relocation')).toBeDefined();
    expect(screen.getByText('Inferred')).toBeDefined();

    // Dispositions are available inside the Drawer itself.
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeDefined();

    // Closing restores the queue in place — the card is still there, the dialog is gone.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Strong fit — ready to submit' })).toBeDefined();
  });
});
