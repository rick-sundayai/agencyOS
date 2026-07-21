import { getEnv } from './env';

/** Fire-and-check the n8n sourcing webhook. Never throws — callers decide what a
 * failure means (the source route marks the run failed immediately). */
export async function fireSourcingWebhook(
  body: { org_id: string; job_order_id: string; sourcing_run_id: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchFn(`${getEnv('N8N_WEBHOOK_URL')}/source`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `n8n webhook returned ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  }
}
