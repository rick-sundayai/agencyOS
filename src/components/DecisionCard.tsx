'use client';

import { DispositionControls } from './DispositionControls';
import { tierMeta } from './tiers';
import type { QueueDecision } from './queue-types';

export function DecisionCard({
  decision,
  onResolved,
  onOpen,
}: {
  decision: QueueDecision;
  onResolved?: (id: string) => void;
  /** Open the review Drawer for this Decision. When absent, the card is non-openable. */
  onOpen?: () => void;
}) {
  const reasoning = decision.reasoning as { summary?: string };
  const isRisk = decision.tier === 'risk';
  const tier = tierMeta(decision.tier);
  const summary = reasoning.summary ?? 'No summary provided';

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

      {/* The summary is the primary affordance: clicking the Decision opens its Drawer. */}
      {onOpen ? (
        <button type="button" className="dcard-summary dcard-summary-btn" onClick={onOpen}>
          {summary}
        </button>
      ) : (
        <p className="dcard-summary">{summary}</p>
      )}

      <DispositionControls decision={decision} onResolved={onResolved} />
    </article>
  );
}
