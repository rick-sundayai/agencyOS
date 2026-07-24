import { getEnv } from './env';

/** n8n has no public Cloud Run invoker (IAM auth required by omission — see
 * infra/modules/stamp/main.tf) — a plain fetch gets a 403 from Cloud Run itself,
 * before the request ever reaches n8n. Google-sign it with an ID token scoped to
 * n8n's own URL, the standard service-to-service auth pattern. Skipped outside
 * Cloud Run (K_SERVICE unset) since local/dev n8n has no such gate. */
async function authHeader(audience: string): Promise<Record<string, string>> {
  const { GoogleAuth } = await import('google-auth-library');
  const client = await new GoogleAuth().getIdTokenClient(audience);
  const token = await client.idTokenProvider.fetchIdToken(audience);
  return { authorization: `Bearer ${token}` };
}

/** Fire-and-check the n8n sourcing webhook. Never throws — callers decide what a
 * failure means (the source route marks the run failed immediately). */
export async function fireSourcingWebhook(
  body: { org_id: string; job_order_id: string; sourcing_run_id: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = getEnv('N8N_WEBHOOK_URL');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (process.env.K_SERVICE) Object.assign(headers, await authHeader(new URL(base).origin));

    const res = await fetchFn(`${base}/source`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `n8n webhook returned ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  }
}
