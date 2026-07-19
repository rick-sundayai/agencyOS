'use client';

import { useLivePendingCount } from './useLivePendingCount';

/**
 * The Control Room shell's top command-bar strip (RecruiterPro's header treatment). Holds
 * only the notification bell — RP's "Ask the team" AI button and global search box are
 * omitted because AgencyOS has no AI-chat or operator-search backend to wire them to.
 */
export function TopBar({ pendingCount }: { pendingCount: number }) {
  const count = useLivePendingCount(pendingCount);
  return (
    <div className="topbar">
      <div className="topbar-spacer" />
      <button
        type="button"
        className="btn btn-icon btn-sm btn-ghost bell"
        aria-label={count > 0 ? `Notifications, ${count} decisions pending` : 'Notifications'}
      >
        {bellIcon()}
        {count > 0 && (
          <span className="bell-badge tnum" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

function bellIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
