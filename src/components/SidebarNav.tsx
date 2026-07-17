'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { QueueDecision } from './queue-types';

/**
 * The Control Room's primary navigation. Renders the domain sections (adapted from
 * RecruiterPro's IA — Clients is kept because AgencyOS has a real CRM the source lacked),
 * marks the active section from the current pathname, and shows a live count of pending
 * Decisions on the Cockpit item so the operator knows there's work without opening it.
 *
 * The count is seeded from a server snapshot and then kept live off the same Cockpit
 * stream the queue itself consumes, so it stays current on any page — new proposals bump
 * it, dispositions drop it — without a navigation.
 */

type NavItem = { href: string; label: string; icon: ReactNode };

const NAV: NavItem[] = [
  { href: '/', label: 'Cockpit', icon: inboxIcon() },
  { href: '/jobs', label: 'Job Orders', icon: briefcaseIcon() },
  { href: '/candidates', label: 'Candidates', icon: usersIcon() },
  { href: '/clients', label: 'Clients', icon: buildingIcon() },
  { href: '/agents', label: 'Agents', icon: sparkleIcon() },
  { href: '/pipeline', label: 'Pipeline', icon: pipelineIcon() },
];

/**
 * Keeps the pending-Decision count live off the Cockpit stream (the same source QueueLive
 * reads). Seeded with the server-rendered snapshot so the badge is correct before the
 * stream connects; on a dropped stream it holds the last known value rather than lying.
 */
function useLivePendingCount(initial: number): number {
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

function isActive(pathname: string, href: string): boolean {
  // The Cockpit lives at the root, so it's active only on an exact match; every other
  // section stays active while the operator drills into its record pages (/jobs/:id, …).
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ pendingCount }: { pendingCount: number }) {
  const pathname = usePathname();
  const count = useLivePendingCount(pendingCount);
  return (
    <nav className="sidebar-nav" aria-label="Primary">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`navbtn${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="nav-ico" aria-hidden="true">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {item.href === '/' && count > 0 && (
              <span className="nav-badge tnum" aria-label={`${count} decisions pending`}>
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/* --- Inline stroke icons (currentColor, so they inherit the nav's active/idle tone).
   `svg` and the icon builders are function declarations so they're hoisted above NAV. --- */
function svg(children: ReactNode) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function inboxIcon() { return svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>); }
function briefcaseIcon() { return svg(<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>); }
function usersIcon() { return svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>); }
function buildingIcon() { return svg(<><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01" /></>); }
function sparkleIcon() { return svg(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />); }
function pipelineIcon() { return svg(<><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></>); }
