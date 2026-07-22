import { auth } from '../../../../lib/auth';
import { listQueue, type DecisionRow } from '../../../../services/decision-store';
import { startCockpitPolling, type StopPolling } from '../../../../services/cockpit-stream-poller';

export const dynamic = 'force-dynamic';

const POLL_MS = 5000;

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;

  const encoder = new TextEncoder();
  // Assigned once startCockpitPolling's first (awaited) snapshot completes, below. cancel()
  // only ever runs after start() has had a chance to run, so this is never called as a no-op
  // when there's a real timer to clear.
  let stop: StopPolling = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      stop = await startCockpitPolling<DecisionRow[]>({
        fetchQueue: () => listQueue(orgId),
        push: (queue) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ queue })}\n\n`)),
        onPushError: () => {
          // enqueue threw (client went away) — stop() already ran inside the poller;
          // just close our side of the controller too.
          try { controller.close(); } catch { /* already closed */ }
        },
        pollMs: POLL_MS,
      });
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
