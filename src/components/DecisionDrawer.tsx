'use client';

import { useEffect, useRef } from 'react';
import { DispositionControls } from './DispositionControls';
import { tierMeta } from './tiers';
import type { QueueDecision } from './queue-types';

/**
 * A single evidence item. Today's proposers emit bare strings (no provenance); the Drawer
 * also renders the richer shape so that once reasoning carries provenance, sourced evidence
 * shows its source link and inferred evidence is tinted — no drawer change needed then.
 */
type EvidenceItem =
  | string
  | { text: string; source?: { label?: string; url: string }; inferred?: boolean };

function normalize(item: EvidenceItem): { text: string; source?: { label?: string; url: string }; inferred: boolean } {
  if (typeof item === 'string') return { text: item, inferred: false };
  return { text: item.text, source: item.source, inferred: item.inferred ?? false };
}

/**
 * The Decision review Drawer: a slide-over the Cockpit owns and opens for a single Decision
 * without leaving the queue. Shows full reasoning, evidence rows (sourced vs inferred, with
 * source links), and payload; dispositions are available in the footer. Records are never
 * shown here — they open as full pages.
 */
export function DecisionDrawer({
  decision,
  onClose,
  onResolved,
}: {
  decision: QueueDecision;
  onClose: () => void;
  onResolved?: (id: string) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  // Esc closes the Drawer, restoring the queue in place.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the Drawer on open and restore it to the trigger on close, so a
  // keyboard/screen-reader user follows the dialog rather than being stranded behind it.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const reasoning = decision.reasoning as {
    summary?: string;
    evidence?: EvidenceItem[];
    model?: string;
    prompt_version?: string;
  };
  const evidence = (reasoning.evidence ?? []).map(normalize);
  const tier = tierMeta(decision.tier);

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside
        ref={panelRef}
        className="rp-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Review decision: ${decision.action_class}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <span className={`tbadge ${tier.tone}`}>{tier.label}</span>
          <strong className="mono drawer-action">{decision.action_class}</strong>
          <button type="button" className="btn btn-icon btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div className="drawer-body">
          <p className="drawer-summary">{reasoning.summary ?? 'No summary provided'}</p>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Evidence</h3>
            {evidence.length === 0 ? (
              <p className="drawer-empty">No evidence recorded.</p>
            ) : (
              <ul className="evlist">
                {evidence.map((e, i) => (
                  <li key={i} className={`evrow${e.inferred ? ' inferred' : ''}`}>
                    <span className="evrow-mark" aria-hidden="true">{e.inferred ? '~' : '•'}</span>
                    <span className="evrow-text">{e.text}</span>
                    {e.source ? (
                      <a className="srclink" href={e.source.url} target="_blank" rel="noopener noreferrer">
                        {e.source.label ?? 'Source'}
                      </a>
                    ) : (
                      <span className="evrow-prov">{e.inferred ? 'Inferred' : ''}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="dcard-meta">
            {reasoning.model ?? 'unknown model'} · {reasoning.prompt_version ?? 'unversioned'}
          </p>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Payload</h3>
            <pre className="drawer-payload">{JSON.stringify(decision.payload, null, 2)}</pre>
          </section>
        </div>

        <footer className="drawer-footer">
          <DispositionControls decision={decision} onResolved={onResolved} />
        </footer>
      </aside>
    </div>
  );
}
