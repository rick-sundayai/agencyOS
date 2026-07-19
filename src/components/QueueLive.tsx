'use client';

import { useEffect, useState } from 'react';
import { DecisionCard } from './DecisionCard';
import { DecisionDrawer } from './DecisionDrawer';
import { subscribeCockpitStream } from './cockpit-stream';
import type { QueueDecision } from './queue-types';

export function QueueLive({ initial }: { initial: QueueDecision[] }) {
  const [queue, setQueue] = useState(initial);
  const [connected, setConnected] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    // Shared with useLivePendingCount's stream subscription — a dropped connection means
    // the queue may now be stale, so say so instead of leaving a frozen "live" view on screen.
    return subscribeCockpitStream((s) => {
      setQueue(s.queue);
      setConnected(s.connected);
    });
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
