import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchIdToken = vi.fn(async (_audience: string) => 'fake-id-token');
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    async getIdTokenClient(_audience: string) {
      return { idTokenProvider: { fetchIdToken: mockFetchIdToken } };
    }
  },
}));

import { fireSourcingWebhook } from './n8n';

const body = { org_id: 'org-1', job_order_id: 'job-1', sourcing_run_id: 'run-1' };

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('N8N_WEBHOOK_URL', 'https://n8n-abc-uc.a.run.app/webhook');
  mockFetchIdToken.mockClear();
});

describe('fireSourcingWebhook', () => {
  it('posts to N8N_WEBHOOK_URL + /source', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await fireSourcingWebhook(body, fetchFn);
    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://n8n-abc-uc.a.run.app/webhook/source',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    );
  });

  it('attaches a Google-signed identity token when running on Cloud Run (K_SERVICE set)', async () => {
    vi.stubEnv('K_SERVICE', 'app');
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    await fireSourcingWebhook(body, fetchFn);
    expect(mockFetchIdToken).toHaveBeenCalledWith('https://n8n-abc-uc.a.run.app');
    const [, init] = fetchFn.mock.calls[0];
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer fake-id-token');
  });

  it('does not attach an identity token outside Cloud Run (no K_SERVICE)', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    await fireSourcingWebhook(body, fetchFn);
    expect(mockFetchIdToken).not.toHaveBeenCalled();
    const [, init] = fetchFn.mock.calls[0];
    expect((init!.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('returns ok:false with the status when n8n responds non-2xx', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 403 }));
    const result = await fireSourcingWebhook(body, fetchFn);
    expect(result).toEqual({ ok: false, error: 'n8n webhook returned 403' });
  });

  it('returns ok:false when fetch throws', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('connect ECONNREFUSED'); });
    const result = await fireSourcingWebhook(body, fetchFn);
    expect(result).toEqual({ ok: false, error: 'connect ECONNREFUSED' });
  });
});
