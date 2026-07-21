'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Run = {
  id: string;
  phase: string;
  stats: Record<string, number | string | undefined> & { jobdiva_error?: string };
  error: string | null;
};
type ShortlistEntry = {
  candidate_id: string; full_name: string; current_title: string | null;
  distance: number; fit_rating: string | null;
};

const POLL_MS = 2500;
const TERMINAL = new Set(['done', 'failed']);

const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued…',
  searching_pool: 'Searching internal pool…',
  checking_jobdiva: 'Checking JobDiva…',
  embedding_new: 'Embedding new candidates…',
  shortlisting: 'Building shortlist…',
  screening: 'Handing off to screening…',
};

const FIT: Record<string, { label: string; tone: string }> = {
  yes: { label: 'Strong fit', tone: 'fit-good' },
  borderline: { label: 'Borderline', tone: 'fit-warn' },
  no: { label: 'Poor fit', tone: 'fit-bad' },
};

export default function SourcingPanel({ jobId, autoStart }: { jobId: string; autoStart: boolean }) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistEntry[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const prevPhase = useRef<string | null>(null);
  const autoFired = useRef(false);
  // Keep the latest router in a ref rather than a poll() dependency: some
  // useRouter() implementations (and this component's test mock) return a
  // new object identity every render, which would otherwise recreate poll()
  // on every render and re-fire the mount effect in a loop. Synced in an
  // effect (not during render) per the react-hooks/refs rule.
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

  const active = run !== null && !TERMINAL.has(run.phase);

  const poll = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}/source`);
    if (!res.ok) return;
    const data = (await res.json()) as { run: Run | null; shortlist: ShortlistEntry[] | null };
    setRun(data.run);
    setShortlist(data.shortlist);
    setLoaded(true);
    // Refresh the server-rendered pipeline board once the run completes.
    if (data.run && data.run.phase === 'done' && prevPhase.current !== 'done') routerRef.current.refresh();
    prevPhase.current = data.run?.phase ?? null;
  }, [jobId]);

  const start = useCallback(async () => {
    await fetch(`/api/jobs/${jobId}/source`, { method: 'POST' });
    await poll();
  }, [jobId, poll]);

  // Standard fetch-on-mount pattern (see react.dev "Fetching data"): poll()
  // is async and only calls setState after its first await, so this doesn't
  // cause the synchronous cascading re-render the rule guards against — the
  // compiler's static analysis can't see that timing, hence the disable.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void poll(); }, [poll]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { void poll(); }, POLL_MS);
    return () => clearInterval(t);
  }, [active, poll]);

  // ?source=1 after a JobDiva import: fire once, only when nothing is already running
  // (the server's 409 guard makes a stale bookmark harmless anyway).
  useEffect(() => {
    if (autoStart && loaded && !active && !autoFired.current) {
      autoFired.current = true;
      void start();
    }
  }, [autoStart, loaded, active, start]);

  const jd = run?.stats?.jobdiva_error;

  return (
    <section className="detail-panel">
      <div className="panel-head-row">
        <h2>Sourcing</h2>
        <button
          type="button"
          className="btn btn-primary"
          disabled={active}
          onClick={() => void start()}
        >
          {active ? 'Sourcing…' : run?.phase === 'failed' ? 'Retry' : 'Source candidates'}
        </button>
      </div>

      {run && !TERMINAL.has(run.phase) && (
        <p className="sourcing-status">
          <span className="dot working" aria-hidden="true" />
          {PHASE_LABEL[run.phase] ?? run.phase}
          {typeof run.stats?.pool_matches === 'number' && ` · ${run.stats.pool_matches} pool matches`}
          {typeof run.stats?.jobdiva_found === 'number' && ` · ${run.stats.jobdiva_found} JobDiva hits`}
          {typeof run.stats?.embedded === 'number' && ` · ${run.stats.embedded} embedded`}
        </p>
      )}

      {run?.phase === 'failed' && (
        <p className="sourcing-error">{run.error ?? 'Sourcing failed.'}</p>
      )}

      {typeof jd === 'string' && (
        <p className="sourcing-note">JobDiva unavailable — internal pool only.</p>
      )}

      {run?.phase === 'done' && shortlist !== null && shortlist.length === 0 && (
        <p className="empty">No matching candidates found — consider loosening the must-haves.</p>
      )}

      {shortlist !== null && shortlist.length > 0 && (
        <ol className="shortlist">
          {shortlist.map((s) => {
            const f = s.fit_rating ? FIT[s.fit_rating] : null;
            return (
              <li key={s.candidate_id} className="card shortlist-card">
                <Link href={`/candidates/${s.candidate_id}`} className="shortlist-name">
                  {s.full_name}
                </Link>
                {s.current_title && <span className="shortlist-title">{s.current_title}</span>}
                <span className="chip tnum">distance {Number(s.distance).toFixed(3)}</span>
                {f && <span className={`fit-badge ${f.tone}`}>{f.label}</span>}
              </li>
            );
          })}
        </ol>
      )}

      {loaded && run === null && shortlist === null && (
        <p className="empty">Not sourced yet.</p>
      )}
    </section>
  );
}
