// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLivePendingCount } from './useLivePendingCount';

class MockEventSource {
  static instances: MockEventSource[] = [];
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

describe('useLivePendingCount', () => {
  it('starts at the seeded initial count', () => {
    const { result } = renderHook(() => useLivePendingCount(3));
    expect(result.current).toBe(3);
  });

  it('connects to the Cockpit stream', () => {
    renderHook(() => useLivePendingCount(0));
    expect(MockEventSource.instances[0].url).toBe('/api/cockpit/stream');
  });

  it('updates the count from stream messages', () => {
    const { result } = renderHook(() => useLivePendingCount(0));
    act(() => {
      MockEventSource.instances[0].onmessage?.({
        data: JSON.stringify({ queue: [{}, {}, {}] }),
      });
    });
    expect(result.current).toBe(3);
  });

  it('holds the last known count when the stream drops, rather than resetting it', () => {
    const { result } = renderHook(() => useLivePendingCount(0));
    act(() => {
      MockEventSource.instances[0].onmessage?.({ data: JSON.stringify({ queue: [{}, {}, {}, {}, {}] }) });
    });
    expect(result.current).toBe(5);
    act(() => {
      MockEventSource.instances[0].onerror?.();
    });
    expect(result.current).toBe(5);
  });
});
