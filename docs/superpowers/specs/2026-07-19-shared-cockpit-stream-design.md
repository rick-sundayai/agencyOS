# Shared Cockpit SSE stream

## Problem

On the Cockpit page (`/`), three client components each open their own `EventSource('/api/cockpit/stream')`:

- `useLivePendingCount` ([useLivePendingCount.ts](../../../src/components/useLivePendingCount.ts)) — called by both `SidebarNav.tsx` and `TopBar.tsx`, each call creating its own connection. Both components render in `layout.tsx` on every authenticated page (not just `/`).
- `QueueLive` ([QueueLive.tsx](../../../src/components/QueueLive.tsx)) — mounted only on the Cockpit page (`src/app/page.tsx`).

(At the time this spec was first drafted, `TopBar.tsx` didn't exist yet on this branch — it landed on `main` via a concurrent PR that also extracted `useLivePendingCount` into its own file. This spec was updated after merging that work in, so the 3-connection count now matches the original problem statement exactly.)

All three parse the same `{ queue: QueueDecision[] }` payload for their own purposes (pending count vs. full queue state + connection banner). That's 3 concurrent long-lived SSE connections per tab against the same endpoint on `/`, against the browser's per-origin connection cap (6, shared across all tabs to that origin).

## Approach

A module-level singleton (`src/components/cockpit-stream.ts`) owns a single `EventSource`, created lazily on the first subscriber and closed when the last subscriber unsubscribes (ref-counted via a `Set` of listeners). No React Context/provider — subscribers call a plain `subscribeCockpitStream(listener)` function from a `useEffect`, so it works from any client component regardless of position in the tree.

```ts
type StreamState = { queue: QueueDecision[]; connected: boolean };
type Listener = (state: StreamState) => void;

let eventSource: EventSource | null = null;
let listeners = new Set<Listener>();
let cachedQueue: QueueDecision[] | null = null;
let cachedConnected = true;

function subscribeCockpitStream(listener: Listener): () => void {
  listeners.add(listener);
  if (!eventSource) {
    eventSource = new EventSource('/api/cockpit/stream');
    eventSource.onopen = () => { cachedConnected = true; notify(); };
    eventSource.onmessage = (ev) => {
      cachedQueue = (JSON.parse(ev.data) as { queue: QueueDecision[] }).queue;
      notify();
    };
    eventSource.onerror = () => { cachedConnected = false; notify(); };
  }
  // Seed a late subscriber immediately with the current cached state, so a component
  // mounting after the connection is already live (e.g. QueueLive mounting while
  // SidebarNav's connection is already open) doesn't show a stale server snapshot
  // until the next ~5s poll tick.
  if (cachedQueue !== null) listener({ queue: cachedQueue, connected: cachedConnected });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      eventSource?.close();
      eventSource = null;
      cachedQueue = null;
      cachedConnected = true;
    }
  };
}

function notify() {
  const state: StreamState = { queue: cachedQueue ?? [], connected: cachedConnected };
  listeners.forEach((l) => l(state));
}
```

### `useLivePendingCount`

Stays in its own file (`useLivePendingCount.ts`), rebuilt on the shared primitive from `cockpit-stream.ts` instead of opening its own `EventSource`:

```ts
export function useLivePendingCount(initial: number): number {
  const [count, setCount] = useState(initial);
  useEffect(() => subscribeCockpitStream((s) => setCount(s.queue.length)), []);
  return count;
}
```

`SidebarNav.tsx` imports it instead of defining it. Behavior preserved: seeds from the server-rendered `initial` prop; on a stream error, `cachedQueue` doesn't change, so `count` silently holds its last value (matches today's behavior, which never had an `onerror` handler at all).

### `QueueLive`

Drops its own `new EventSource(...)` effect, subscribes to the shared primitive instead:

```ts
useEffect(() => subscribeCockpitStream((s) => {
  setQueue(s.queue);
  setConnected(s.connected);
}), []);
```

Behavior preserved: `queue` still starts from the `initial` prop (server snapshot) until the first shared update; `connected` still flips to `false` on stream error (showing the "Live updates interrupted" banner) and back to `true` on reopen — just relayed through the singleton instead of a private `EventSource`.

## Data flow

```
Cockpit page mount
  SidebarNav  --useLivePendingCount--> subscribeCockpitStream(listenerA)  -\
  TopBar      --useLivePendingCount--> subscribeCockpitStream(listenerB)   -> singleton creates ONE
  QueueLive   --useEffect-----------> subscribeCockpitStream(listenerC)  -/    EventSource on first subscriber

/api/cockpit/stream pushes `data: {queue}\n\n` (initial push + every 5s)
  -> singleton's onmessage updates cachedQueue, calls notify()
  -> listenerA updates SidebarNav's pending count
  -> listenerB updates TopBar's pending count
  -> listenerC updates QueueLive's queue + connected

Any component unmounts -> unsubscribe -> listener removed from Set
Last component unmounts -> Set empty -> EventSource closed, cache reset
```

## Testing

- **`src/components/cockpit-stream.test.ts`** (new): unit-tests the singleton primitive directly —
  - only one `EventSource` is created across multiple `subscribeCockpitStream` calls (fan-out)
  - a single `onmessage` event updates every subscriber
  - a late subscriber (subscribing after a message has already arrived) is seeded immediately with the cached state, not left waiting for the next message
  - the `EventSource` is closed when the last subscriber unsubscribes, and a fresh one is created if a new subscriber arrives afterward
  - `onerror` marks `connected: false` for all subscribers without clearing `cachedQueue`; `onopen` restores `connected: true`
- **`src/components/useLivePendingCount.test.ts`** (existing, from the concurrent `TopBar` PR): seeds from `initial`, updates on message, holds last value on error — assertions unchanged, still pass against the shared primitive.
- **`src/components/TopBar.test.tsx`** (existing): unchanged, still passes.
- **`src/components/QueueLive.test.tsx`** (existing): assertions unchanged — `MockEventSource.instances[0]` still resolves to the one-and-only `EventSource` when `QueueLive` is the only mounted consumer in that test file.

## Out of scope

- No React Context/provider in `layout.tsx`.
- No change to `/api/cockpit/stream`'s polling behavior or payload shape.
- No new SidebarNav/TopBar integration test for the fan-out case — covered at the `cockpitStream` unit level instead, per user preference.
