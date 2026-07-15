import { auth } from '../lib/auth';
import { listQueue } from '../services/decision-store';
import { QueueLive } from '../components/QueueLive';
import { serializeDecision } from '../components/queue-types';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const session = await auth();
  if (!session) return null; // middleware redirects before this can render
  const queue = await listQueue(session.user.org_id);
  return (
    <main>
      <h1>Decision queue</h1>
      <QueueLive initial={queue.map(serializeDecision)} />
    </main>
  );
}
