'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ERROR_COPY: Record<string, string> = {
  job_not_found_in_jobdiva: 'That job number was not found in JobDiva.',
  jobdiva_unavailable: 'JobDiva is unavailable right now — try again in a minute.',
};

export default function SourceFromJobDiva() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/jobs/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobdiva_job_number: value.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(ERROR_COPY[body.error] ?? 'Import failed — try again.');
        return;
      }
      router.push(`/jobs/${body.job_order_id}?source=1`);
    } catch {
      setError('Import failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="jd-source-form" onSubmit={submit}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="JobDiva job #"
        aria-label="JobDiva job number"
      />
      <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
        {busy ? 'Importing…' : 'Source'}
      </button>
      {error && <p className="sourcing-error">{error}</p>}
    </form>
  );
}
