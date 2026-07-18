import { auth } from '../lib/auth';
import { listQueue } from '../services/decision-store';
import { listRoster } from '../services/agent-roster';
import { computeHealthSignals } from '../services/health-rail';
import { QueueLive } from '../components/QueueLive';
import { HealthRail, HealthStrip } from '../components/HealthRail';
import { serializeDecision } from '../components/queue-types';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const session = await auth();
  if (!session) return null; // middleware redirects before this can render
  const queue = await listQueue(session.user.org_id);
  const roster = await listRoster(session.user.org_id);
  const signals = computeHealthSignals({ queue, roster });
  return (
    <main>
      <h1>Decision queue</h1>
      <HealthStrip signals={signals} />
      <HealthRail signals={signals} />
      <QueueLive initial={queue.map(serializeDecision)} />
    </main>
  );
}
