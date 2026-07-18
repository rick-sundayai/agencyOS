import Link from 'next/link';
import type { HealthSignal } from '../services/health-rail';

/**
 * The Health rail: dumb tiles rendering the health selector's output. Calm by default —
 * a healthy tile is monochrome, coloured only when warn/alert, so colour is the only alarm.
 * Each tile drills into the underlying view.
 */
export function HealthRail({ signals }: { signals: HealthSignal[] }) {
  return (
    <div className="hrail">
      {signals.map((s) => (
        <Link key={s.id} href={s.drill} className={`htile htile-${s.status}`}>
          <div className="htile-head">
            <span className="dot htile-dot" aria-hidden="true" />
            <span className="htile-label">{s.label}</span>
          </div>
          <div className="htile-value">
            <span className="display tnum">{s.value}</span>
            <span className="htile-unit">{s.unit}</span>
          </div>
          <div className="htile-detail">{s.detail}</div>
        </Link>
      ))}
    </div>
  );
}

/**
 * A condensed status line: near-empty when everything is healthy ("All systems healthy"),
 * otherwise only the warn/alert signals as drill-in pills. The healthy signals never clutter.
 */
export function HealthStrip({ signals }: { signals: HealthSignal[] }) {
  const alerts = signals.filter((s) => s.status !== 'good');
  if (alerts.length === 0) {
    return <div className="hstrip hstrip-healthy">All systems healthy</div>;
  }
  return (
    <div className="hstrip">
      {alerts.map((s) => (
        <Link key={s.id} href={s.drill} className={`cstrip-pill cstrip-${s.status}`}>
          <span className="dot" aria-hidden="true" />
          <b>{s.label}:</b> {s.detail}
        </Link>
      ))}
    </div>
  );
}
