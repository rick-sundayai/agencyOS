import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startCockpitPolling } from './cockpit-stream-poller';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startCockpitPolling', () => {
  it('pushes an initial snapshot immediately, before any timer tick', async () => {
    const push = vi.fn();
    const fetchQueue = vi.fn().mockResolvedValue(['row-1']);
    await startCockpitPolling({ fetchQueue, push, onPushError: vi.fn(), pollMs: 5000 });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(['row-1']);
  });

  it('polls again every pollMs after the initial snapshot', async () => {
    const push = vi.fn();
    const fetchQueue = vi.fn().mockResolvedValue(['row-1']);
    await startCockpitPolling({ fetchQueue, push, onPushError: vi.fn(), pollMs: 5000 });
    expect(fetchQueue).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchQueue).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchQueue).toHaveBeenCalledTimes(3);
  });

  it('stops polling and calls onPushError exactly once when push throws', async () => {
    const push = vi.fn(() => { throw new Error('controller closed'); });
    const fetchQueue = vi.fn().mockResolvedValue(['row-1']);
    const onPushError = vi.fn();
    await startCockpitPolling({ fetchQueue, push, onPushError, pollMs: 5000 });
    expect(onPushError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000);
    // No further ticks: push already threw on the very first (immediate) call, so no
    // interval was ever created.
    expect(fetchQueue).toHaveBeenCalledTimes(1);
    expect(onPushError).toHaveBeenCalledTimes(1);
  });

  it('stops polling and calls onPushError when push throws on a later tick', async () => {
    let calls = 0;
    const push = vi.fn(() => {
      calls += 1;
      if (calls === 2) throw new Error('controller closed');
    });
    const fetchQueue = vi.fn().mockResolvedValue(['row-1']);
    const onPushError = vi.fn();
    await startCockpitPolling({ fetchQueue, push, onPushError, pollMs: 5000 });

    await vi.advanceTimersByTimeAsync(5000); // second push — throws
    expect(onPushError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20_000); // no further ticks after the error
    expect(fetchQueue).toHaveBeenCalledTimes(2);
  });

  it('calling stop() clears the interval — no further pushes', async () => {
    const push = vi.fn();
    const fetchQueue = vi.fn().mockResolvedValue(['row-1']);
    const stop = await startCockpitPolling({ fetchQueue, push, onPushError: vi.fn(), pollMs: 5000 });
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchQueue).toHaveBeenCalledTimes(1); // only the initial snapshot
  });

  it('does not push if stop() is called while a fetch is still in flight', async () => {
    const push = vi.fn();
    let resolveFetch: (rows: string[]) => void = () => {};
    const fetchQueue = vi.fn(() => new Promise<string[]>((resolve) => { resolveFetch = resolve; }));

    const startPromise = startCockpitPolling({ fetchQueue, push, onPushError: vi.fn(), pollMs: 5000 });
    // The initial tick's fetchQueue() call is in flight; resolve it so the first snapshot
    // lands and startCockpitPolling can return its stop function.
    resolveFetch(['row-1']);
    const stop = await startPromise;
    expect(push).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000); // fires the second tick's fetchQueue()
    stop(); // stop before that second fetchQueue() resolves
    resolveFetch(['row-2']);
    await Promise.resolve();
    await Promise.resolve();
    expect(push).toHaveBeenCalledTimes(1); // the second result never got pushed
  });
});
