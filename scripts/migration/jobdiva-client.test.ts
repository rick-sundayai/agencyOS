import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobDivaClient } from './jobdiva-client';

const creds = { clientid: 'c', username: 'u', password: 'p' };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const ok = (body: unknown, init: { status?: number; text?: boolean } = {}) => ({
  ok: (init.status ?? 200) < 400,
  status: init.status ?? 200,
  text: async () => String(body),
  json: async () => body,
});

describe('JobDivaClient', () => {
  it('authenticates once and reuses the bearer token', async () => {
    fetchMock
      .mockResolvedValueOnce(ok('raw-token'))
      .mockResolvedValueOnce(ok({ data: [{ ID: 1 }] }));
    const c = new JobDivaClient(creds);
    const resp = await c.get('/apiv2/bi/JobDetail', { jobId: '1' });
    expect(JobDivaClient.rows(resp)).toEqual([{ ID: 1 }]);
    expect(fetchMock.mock.calls[0][0]).toContain('/apiv2/v2/authenticate?');
    const authHeader = fetchMock.mock.calls[1][1].headers.Authorization;
    expect(authHeader).toBe('Bearer raw-token');
  });

  it('backs off and retries on 429, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(ok('t'))
      .mockResolvedValueOnce(ok('slow down', { status: 429 }))
      .mockResolvedValueOnce(ok({ data: [{ ID: 2 }] }));
    const c = new JobDivaClient(creds);
    const p = c.get('/apiv2/bi/JobDetail', { jobId: '2' });
    await vi.advanceTimersByTimeAsync(5000); // covers first 2s(+jitter) backoff
    const resp = await p;
    expect(JobDivaClient.rows(resp)).toEqual([{ ID: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('re-authenticates once on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(ok('stale'))
      .mockResolvedValueOnce(ok('denied', { status: 401 }))
      .mockResolvedValueOnce(ok('fresh'))
      .mockResolvedValueOnce(ok({ data: [] }));
    const c = new JobDivaClient(creds);
    await c.get('/apiv2/bi/CandidateDetail', { candidateId: '9' });
    const lastAuth = fetchMock.mock.calls[3][1].headers.Authorization;
    expect(lastAuth).toBe('Bearer fresh');
  });

  it('rows() handles bare arrays and {data} envelopes', () => {
    expect(JobDivaClient.rows([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(JobDivaClient.rows({ data: [{ b: 2 }] })).toEqual([{ b: 2 }]);
    expect(JobDivaClient.rows({ nope: true })).toEqual([]);
  });
});
