'use client';

import type { QueueDecision } from './queue-types';

/**
 * A single shared subscription to the Cockpit SSE stream (`/api/cockpit/stream`), so
 * multiple consumers (useLivePendingCount's two callers, QueueLive) don't each open their
 * own EventSource against the same endpoint. The connection is created lazily on the first
 * subscriber and torn down once the last one unsubscribes.
 */

export type CockpitStreamState = { queue: QueueDecision[]; connected: boolean };
type Listener = (state: CockpitStreamState) => void;

let eventSource: EventSource | null = null;
let listeners = new Set<Listener>();
let cachedQueue: QueueDecision[] | null = null;
let cachedConnected = true;

function notify(): void {
  const state: CockpitStreamState = { queue: cachedQueue ?? [], connected: cachedConnected };
  listeners.forEach((listener) => listener(state));
}

export function subscribeCockpitStream(listener: Listener): () => void {
  listeners.add(listener);
  if (!eventSource) {
    eventSource = new EventSource('/api/cockpit/stream');
    eventSource.onopen = () => {
      cachedConnected = true;
      notify();
    };
    eventSource.onmessage = (ev) => {
      cachedQueue = (JSON.parse(ev.data) as { queue: QueueDecision[] }).queue;
      notify();
    };
    // Fires for a dropped connection AND for a session-expired redirect toward /login
    // (not text/event-stream, so EventSource treats it as an error).
    eventSource.onerror = () => {
      cachedConnected = false;
      notify();
    };
  }
  // Seed a late subscriber immediately, so mounting after the connection is already live
  // (e.g. QueueLive mounting while SidebarNav's connection is already open) doesn't show a
  // stale server snapshot until the next poll tick.
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
