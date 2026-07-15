// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

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
