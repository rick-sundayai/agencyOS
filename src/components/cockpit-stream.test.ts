// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { QueueDecision } from './queue-types';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { MockEventSource.instances.push(this); }
  close() { this.closed = true; }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).EventSource = MockEventSource;
  vi.resetModules();
});

const decision: QueueDecision = {
  id: 'd-1',
  org_id: 'o-1',
  agent: 'placement',
  action_class: 'client.submit_candidate',
  tier: '3',
  state: 'proposed',
  reasoning: { summary: 'x', evidence: [], model: 'claude', prompt_version: 'v1' },
  payload: {},
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

async function loadModule() {
  return import('./cockpit-stream');
}

describe('subscribeCockpitStream fan-out', () => {
  it('creates only one EventSource for multiple subscribers', async () => {
    const { subscribeCockpitStream } = await loadModule();
    const unsubA = subscribeCockpitStream(() => {});
    const unsubB = subscribeCockpitStream(() => {});
    expect(MockEventSource.instances.length).toBe(1);
    unsubA();
    unsubB();
  });

  it('notifies every subscriber on a single message', async () => {
    const { subscribeCockpitStream } = await loadModule();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeCockpitStream(a);
    const unsubB = subscribeCockpitStream(b);
    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage?.({ data: JSON.stringify({ queue: [decision] }) });
    });
    expect(a).toHaveBeenCalledWith({ queue: [decision], connected: true });
    expect(b).toHaveBeenCalledWith({ queue: [decision], connected: true });
    unsubA();
    unsubB();
  });

  it('seeds a late subscriber immediately with the cached state', async () => {
    const { subscribeCockpitStream } = await loadModule();
    const unsubA = subscribeCockpitStream(() => {});
    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage?.({ data: JSON.stringify({ queue: [decision] }) });
    });
    const late = vi.fn();
    const unsubB = subscribeCockpitStream(late);
    expect(late).toHaveBeenCalledWith({ queue: [decision], connected: true });
    unsubA();
    unsubB();
  });

  it('does not seed a late subscriber before any message has arrived', async () => {
    const { subscribeCockpitStream } = await loadModule();
    const unsubA = subscribeCockpitStream(() => {});
    const late = vi.fn();
    const unsubB = subscribeCockpitStream(late);
    expect(late).not.toHaveBeenCalled();
    unsubA();
    unsubB();
  });

  it('closes the EventSource once the last subscriber unsubscribes, and opens a fresh one for a new subscriber', async () => {
    const { subscribeCockpitStream } = await loadModule();
    const unsubA = subscribeCockpitStream(() => {});
    const es = MockEventSource.instances[0];
    unsubA();
    expect(es.closed).toBe(true);

    const unsubB = subscribeCockpitStream(() => {});
    expect(MockEventSource.instances.length).toBe(2);
    unsubB();
  });

  it('marks connected false on error without clearing the cached queue, and true again on reopen', async () => {
    const { subscribeCockpitStream } = await loadModule();
    const listener = vi.fn();
    const unsub = subscribeCockpitStream(listener);
    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage?.({ data: JSON.stringify({ queue: [decision] }) });
    });
    act(() => {
      es.onerror?.();
    });
    expect(listener).toHaveBeenLastCalledWith({ queue: [decision], connected: false });
    act(() => {
      es.onopen?.();
    });
    expect(listener).toHaveBeenLastCalledWith({ queue: [decision], connected: true });
    unsub();
  });
});
