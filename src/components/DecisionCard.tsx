'use client';

import { useEffect, useState, useTransition } from 'react';
import { approveDecisionAction, cancelDecisionAction } from '../app/queue-actions';
import type { QueueDecision } from './queue-types';

const TIER_LABELS: Record<string, string> = {
  '1': 'Auto',
  '2': 'Undo window',
  '3': 'Needs approval',
  risk: 'Risk',
};

function useCountdownMs(expiresAt: string | null): number | null {
  // Date.now() must not be called during render (react-hooks/purity), so the initial value
  // and each tick are both computed inside the effect rather than the useState initializer.
  // The immediate `update()` call (in addition to the setInterval) makes the current
  // countdown available on the very first paint instead of a second later.
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

export function DecisionCard({
  decision,
  onResolved,
}: {
  decision: QueueDecision;
  onResolved?: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const remaining = useCountdownMs(decision.undo_expires_at);

  const reasoning = decision.reasoning as {
    summary?: string;
    evidence?: string[];
    model?: string;
    prompt_version?: string;
  };
  const isRisk = decision.tier === 'risk';
  const inUndoWindow = decision.state === 'approved' && decision.undo_expires_at !== null;

  const act = (action: (id: string) => Promise<unknown>) =>
    startTransition(async () => {
      await action(decision.id);
      onResolved?.(decision.id);
    });

  return (
    <article className={`card tier-${decision.tier}`} data-testid="decision-card">
      <header>
        <span className="badge">{TIER_LABELS[decision.tier] ?? decision.tier}</span>
        <strong>{decision.action_class}</strong>
        <span className="agent">{decision.agent}</span>
        <time>{new Date(decision.proposed_at).toLocaleString()}</time>
      </header>
      <p>{reasoning.summary ?? 'No summary provided'}</p>
      {inUndoWindow && remaining !== null && (
        <p className="countdown">
          Executes in {Math.max(0, Math.floor(remaining / 1000))}s unless cancelled
        </p>
      )}
      <details>
        <summary>Why?</summary>
        <ul>
          {(reasoning.evidence ?? []).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        <p className="meta">
          {reasoning.model ?? 'unknown model'} · {reasoning.prompt_version ?? 'unversioned'}
        </p>
        <pre>{JSON.stringify(decision.payload, null, 2)}</pre>
      </details>
      <footer>
        {decision.state === 'proposed' && !isRisk && (
          <button disabled={pending} onClick={() => act(approveDecisionAction)}>
            Approve
          </button>
        )}
        {inUndoWindow ? (
          <button disabled={pending} className="secondary" onClick={() => act(cancelDecisionAction)}>
            Undo
          </button>
        ) : (
          <button disabled={pending} className="secondary" onClick={() => act(cancelDecisionAction)}>
            {isRisk ? 'Resolve' : 'Reject'}
          </button>
        )}
      </footer>
    </article>
  );
}
