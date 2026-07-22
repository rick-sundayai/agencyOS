'use client';

import { useRouter } from 'next/navigation';

/** Narrows the Candidates grid to one job order via the ?job= URL param, so the page stays
 * server-rendered — this is the only client-side piece. */
export function JobOrderFilter({
  jobOrders,
  selected,
}: {
  jobOrders: Array<{ id: string; title: string }>;
  selected: string | null;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Filter by job order"
      className="job-filter"
      value={selected ?? ''}
      onChange={(e) => {
        const value = e.target.value;
        router.push(value ? `/candidates?job=${value}` : '/candidates');
      }}
    >
      <option value="">All job orders</option>
      {jobOrders.map((j) => (
        <option key={j.id} value={j.id}>{j.title}</option>
      ))}
    </select>
  );
}
