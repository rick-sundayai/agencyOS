'use client';

import { useEffect, useState } from 'react';
import { DecisionCard } from './DecisionCard';
import { DecisionDrawer } from './DecisionDrawer';
import type { QueueDecision } from './queue-types';

export function QueueLive({ initial }: { initial: QueueDecision[] }) {
  const [queue, setQueue] = useState(initial);
  const [connected, setConnected] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/cockpit/stream');
    es.onopen = () => setConnected(true);
    es.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as { queue: QueueDecision[] };
      setQueue(data.queue);
    };
    // Fires for a dropped connection AND for a session-expired redirect toward /login
    // (not text/event-stream, so EventSource treats it as an error). Either way, the
    // queue may now be stale — say so instead of leaving a frozen "live" view on screen.
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const remove = (id: string) => setQueue((q) => q.filter((d) => d.id !== id));
  const resolve = (id: string) => {
    remove(id);
    setOpenId((current) => (current === id ? null : current));
  };

  // Look the open Decision up from the live queue by id, so an open Drawer reflects the
  // latest streamed state rather than a stale snapshot; if it leaves the queue, close.
  const openDecision = openId ? queue.find((d) => d.id === openId) ?? null : null;

  return (
    <>
      {!connected && (
        <p className="banner-warning">
          Live updates interrupted —{' '}
          <button type="button" onClick={() => window.location.reload()}>reload</button>
        </p>
      )}
      {queue.length === 0 ? (
        <p className="empty">Queue is clear — nothing needs you right now.</p>
      ) : (
        <div className="queue">
          {queue.map((d) => (
            <DecisionCard key={d.id} decision={d} onResolved={remove} onOpen={() => setOpenId(d.id)} />
          ))}
        </div>
      )}
      {openDecision && (
        <DecisionDrawer decision={openDecision} onClose={() => setOpenId(null)} onResolved={resolve} />
      )}
    </>
  );
}
