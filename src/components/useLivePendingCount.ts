import { useEffect, useState } from 'react';
import { subscribeCockpitStream } from './cockpit-stream';

/**
 * Keeps a pending-Decision count live off the Cockpit stream (the same shared source
 * QueueLive reads — see cockpit-stream.ts). Seeded with a server-rendered snapshot so
 * callers are correct before the stream connects; on a dropped stream it holds the last
 * known value rather than lying.
 *
 * Shared by the sidebar's Cockpit badge and the top-bar notification bell — both surfaces
 * read the same live count from the same underlying EventSource connection.
 */
export function useLivePendingCount(initial: number): number {
  const [count, setCount] = useState(initial);
  useEffect(() => subscribeCockpitStream((s) => setCount(s.queue.length)), []);
  return count;
}
