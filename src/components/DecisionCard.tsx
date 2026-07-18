'use client';

import { useEffect, useState, useTransition } from 'react';
import { approveDecisionAction, cancelDecisionAction } from '../app/queue-actions';
import type { QueueDecision } from './queue-types';

// Tier label + badge tone, single-sourced so the two can't drift. "Color is the alarm":
// Auto is the calmest (neutral ink), Risk the loudest (bad); Undo-window reads accent,
// Needs-approval reads warn. Unknown tiers fall back together, not half-and-half.
const TIERS: Record<string, { label: string; tone: string }> = {
  '1': { label: 'Auto', tone: 'tbadge-auto' },
  '2': { label: 'Undo window', tone: 'tbadge-undo' },
  '3': { label: 'Needs approval', tone: 'tbadge-approval' },
  risk: { label: 'Risk', tone: 'tbadge-risk' },
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
  const [error, setError] = useState<string | null>(null);
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
      setError(null);
      try {
        await action(decision.id);
        onResolved?.(decision.id);
      } catch (err) {
        // Server actions (approveDecisionAction/cancelDecisionAction) throw friendly,
        // human-facing messages (e.g. a stale-transition race or a role/tier mismatch) —
        // surface them here instead of letting them bubble up and crash the whole page.
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
    });

  const tier = TIERS[decision.tier] ?? { label: decision.tier, tone: 'tbadge-approval' };

  return (
    <article className={`dcard${isRisk ? ' risk' : ''}`} data-testid="decision-card">
      <div className="dcard-head">
        <span className={`tbadge ${tier.tone}`}>
          <span className="dot" aria-hidden="true" />
          {tier.label}
        </span>
        <strong className="dcard-action mono">{decision.action_class}</strong>
        <span className="dcard-agent">{decision.agent}</span>
        <time className="dcard-time">{new Date(decision.proposed_at).toLocaleString()}</time>
      </div>

      <p className="dcard-summary">{reasoning.summary ?? 'No summary provided'}</p>

      {inUndoWindow && remaining !== null && (
        <p className="dcard-countdown mono">
          Executes in {Math.max(0, Math.floor(remaining / 1000))}s unless cancelled
        </p>
      )}

      <details className="dcard-why">
        <summary>Why?</summary>
        <ul>
          {(reasoning.evidence ?? []).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
        <p className="dcard-meta">
          {reasoning.model ?? 'unknown model'} · {reasoning.prompt_version ?? 'unversioned'}
        </p>
        <pre>{JSON.stringify(decision.payload, null, 2)}</pre>
      </details>

      <footer className="dcard-actions">
        {decision.state === 'proposed' && !isRisk && (
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(approveDecisionAction)}>
            Approve
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(cancelDecisionAction)}>
          {inUndoWindow ? 'Undo' : isRisk ? 'Resolve' : 'Reject'}
        </button>
      </footer>

      {error && <p className="dcard-error">{error}</p>}
    </article>
  );
}
