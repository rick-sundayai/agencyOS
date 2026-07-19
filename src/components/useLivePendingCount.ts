import { useEffect, useState } from 'react';
import type { QueueDecision } from './queue-types';

/**
 * Keeps a pending-Decision count live off the Cockpit stream (the same source QueueLive
 * reads). Seeded with a server-rendered snapshot so callers are correct before the stream
 * connects; on a dropped stream it holds the last known value rather than lying.
 *
 * Shared by the sidebar's Cockpit badge and the top-bar notification bell — both surfaces
 * read the same live count from the same stream.
 */
export function useLivePendingCount(initial: number): number {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    const es = new EventSource('/api/cockpit/stream');
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as { queue: QueueDecision[] };
      setCount(data.queue.length);
    };
    return () => es.close();
  }, []);
  return count;
}
