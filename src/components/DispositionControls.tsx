'use client';

import { useEffect, useState, useTransition } from 'react';
import { approveDecisionAction, cancelDecisionAction } from '../app/queue-actions';
import type { QueueDecision } from './queue-types';

function useCountdownMs(expiresAt: string | null): number | null {
  // Date.now() must not be called during render (react-hooks/purity), so the initial value
  // and each tick are both computed inside the effect. The immediate update() makes the
  // current countdown available on the first paint instead of a second later.
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => setRemaining(new Date(expiresAt).getTime() - Date.now());
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return remaining;
}

/**
 * The Decision's disposition controls — Undo-window countdown, the tier/state-gated
 * action buttons, and friendly inline errors. Shared by the queue card and the Drawer so
 * both dispose a Decision through exactly the same rules and error handling.
 */
export function DispositionControls({
  decision,
  onResolved,
}: {
  decision: QueueDecision;
  onResolved?: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const remaining = useCountdownMs(decision.undo_expires_at);

  const isRisk = decision.tier === 'risk';
  const inUndoWindow = decision.state === 'approved' && decision.undo_expires_at !== null;

  const act = (action: (id: string) => Promise<unknown>) =>
    startTransition(async () => {
      setError(null);
      try {
        await action(decision.id);
        onResolved?.(decision.id);
      } catch (err) {
        // Server actions throw friendly, human-facing messages (a stale-transition race,
        // a role/tier mismatch) — surface them here instead of crashing the queue.
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    });

  return (
    <>
      {inUndoWindow && remaining !== null && (
        <p className="dcard-countdown mono">
          Executes in {Math.max(0, Math.floor(remaining / 1000))}s unless cancelled
        </p>
      )}
      <div className="dcard-actions">
        {decision.state === 'proposed' && !isRisk && (
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(approveDecisionAction)}>
            Approve
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(cancelDecisionAction)}>
          {inUndoWindow ? 'Undo' : isRisk ? 'Resolve' : 'Reject'}
        </button>
      </div>
      {error && <p className="dcard-error">{error}</p>}
    </>
  );
}
