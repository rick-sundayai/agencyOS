import { auth } from '../../../../lib/auth';
import { listQueue } from '../../../../services/decision-store';

export const dynamic = 'force-dynamic';

const POLL_MS = 5000;

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = session.user.org_id;

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const push = async () => {
        try {
          const queue = await listQueue(orgId);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ queue })}\n\n`));
        } catch {
          // Client went away (enqueue throws on a closed controller) — stop polling.
          clearInterval(timer);
          try { controller.close(); } catch { /* already closed */ }
        }
      };
      await push(); // first snapshot immediately, then poll
      timer = setInterval(push, POLL_MS);
    },
    cancel() {
      clearInterval(timer);
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
