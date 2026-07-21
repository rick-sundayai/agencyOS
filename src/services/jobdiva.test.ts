import { describe, it, expect, vi } from 'vitest';
import { makeJobDivaClient } from './jobdiva';

function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body: unknown },
) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status = 200, body } = handler(String(input), init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  return fn as unknown as typeof fetch;
}

const CFG = { clientId: 'cid', username: 'u', password: 'p', baseUrl: 'https://jd.test' };

describe('makeJobDivaClient', () => {
  it('authenticates once and reuses the token', async () => {
    const calls: string[] = [];
    const fetchFn = fakeFetch((url) => {
      calls.push(url);
      if (url.includes('/api/authenticate')) return { body: 'tok-1' };
      return { body: [] };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    await client.searchCandidates({ title: 'Dev', mustHaves: ['React'] });
    await client.searchCandidates({ title: 'Dev', mustHaves: ['React'] });
    expect(calls.filter((u) => u.includes('/api/authenticate'))).toHaveLength(1);
  });

  it('re-authenticates once on a 401 and retries the request', async () => {
    let authCount = 0;
    let dataCalls = 0;
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) { authCount++; return { body: `tok-${authCount}` }; }
      dataCalls++;
      if (dataCalls === 1) return { status: 401, body: 'expired' };
      return { body: [{ id: '77', firstName: 'Ada', lastName: 'L' }] };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    const out = await client.searchCandidates({ title: 'Dev', mustHaves: [] });
    expect(authCount).toBe(2);
    expect(out[0]).toMatchObject({ jobdiva_id: '77', full_name: 'Ada L' });
  });

  it('maps a job and returns null for an unknown job number', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('bad-number')) return { status: 404, body: 'nope' };
      return {
        body: [{
          title: 'Platform Engineer', description: 'Build platforms',
          skills: ['Kubernetes', 'Go'], jobType: 'Contract',
        }],
      };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    const job = await client.getJob('42');
    expect(job).toMatchObject({ title: 'Platform Engineer', kind: 'contract', must_haves: ['Kubernetes', 'Go'] });
    expect(await client.getJob('bad-number')).toBeNull();
  });

  it('returns null when a candidate has no resume', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      return { body: [] };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    expect(await client.getResumeText('123')).toBeNull();
  });
});
