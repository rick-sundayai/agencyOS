export type StopPolling = () => void;

/**
 * Owns the Cockpit SSE stream's poll loop and its error-stop semantics — pushes an initial
 * snapshot immediately, then polls `fetchQueue` every `pollMs`, calling `push` with each
 * result. If `push` throws (the SSE client went away and `controller.enqueue` fails on a
 * closed controller), polling stops and `onPushError` fires once.
 *
 * SSE framing and `ReadableStream` wiring stay in the route (`cockpit/stream/route.ts`) —
 * this module is deliberately transport-agnostic (generic over the pushed value, injectable
 * fetch/push) so it's testable with fake timers and plain spies, no real Response/DB/network
 * needed. Mirrors the client-side singleton pattern in `components/cockpit-stream.ts`.
 */
export async function startCockpitPolling<T>(opts: {
  fetchQueue: () => Promise<T>;
  push: (data: T) => void;
  onPushError: () => void;
  pollMs: number;
}): Promise<StopPolling> {
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const data = await opts.fetchQueue();
    if (stopped) return; // stop() may have been called while fetchQueue was in flight
    try {
      opts.push(data);
    } catch {
      stopped = true;
      opts.onPushError();
    }
  };

  await tick(); // first snapshot immediately, before polling starts
  const timer = stopped ? null : setInterval(tick, opts.pollMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
