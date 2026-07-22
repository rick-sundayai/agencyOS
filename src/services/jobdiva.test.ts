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
    // Numeric input is already the internal JobDiva id, so no JobDetail resolution
    // call is needed — isolates this test to the auth-reuse behavior.
    await client.searchCandidates('42');
    await client.searchCandidates('42');
    expect(calls.filter((u) => u.includes('/api/authenticate'))).toHaveLength(1);
  });

  it('re-authenticates once on a 401 and retries the request', async () => {
    let authCount = 0;
    let dataCalls = 0;
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) { authCount++; return { body: `tok-${authCount}` }; }
      dataCalls++;
      if (dataCalls === 1) return { status: 401, body: 'expired' };
      return { body: [{ CANDIDATEID: '77', FIRSTNAME: 'Ada', LASTNAME: 'L' }] };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    const out = await client.searchCandidates('42');
    expect(authCount).toBe(2);
    expect(out[0]).toMatchObject({ jobdiva_id: '77', full_name: 'Ada L' });
  });

  it('searches candidates via JobAgentSearch, resolving a job number to its internal id first', async () => {
    // Pins the live-verified contract (2026-07-22, job 23-00053, per direct account
    // guidance on the real endpoint name): a non-numeric job number is resolved to
    // JobDiva's internal id via JobDetail(jobdivaref) first, then JobAgentSearch is
    // called with that internal jobId + resumeCount. The real response uses
    // ALL-CAPS fields (CANDIDATEID/FIRSTNAME/LASTNAME/PHONE/CITY/PROVINCE/ABSTRACT)
    // — PROVINCE (not STATE) for state, and no email field in the match summary.
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('/apiv2/bi/JobDetail')) {
        expect(url).toContain('jobdivaref=23-00053');
        return { body: { data: [{ ID: '18710242', JOBTITLE: 'Product Analyst' }] } };
      }
      if (url.includes('/apiv2/jobdiva/JobAgentSearch')) {
        expect(url).toContain('jobId=18710242');
        return {
          body: [{
            CANDIDATEID: '19007475835230', FIRSTNAME: 'Manrose', LASTNAME: 'Sohi',
            CITY: 'South Amboy', PROVINCE: 'NJ', PHONE: '7325887099', ABSTRACT: 'Business Analyst',
          }],
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    const out = await client.searchCandidates('23-00053');
    expect(out).toEqual([{
      jobdiva_id: '19007475835230',
      full_name: 'Manrose Sohi',
      email: null,
      phone: '7325887099',
      current_title: 'Business Analyst',
      location: 'South Amboy, NJ',
    }]);
  });

  it('returns no hits when the job number cannot be resolved to a JobDiva job', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('/apiv2/bi/JobDetail')) return { status: 404, body: 'nope' };
      throw new Error('should not call JobAgentSearch when the job cannot be resolved');
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    expect(await client.searchCandidates('no-such-job')).toEqual([]);
  });

  it('sends resumeCount as a query param when opts.resumeCount is passed', async () => {
    let capturedUrl = '';
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      capturedUrl = url;
      return { body: [] };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    await client.searchCandidates('42', { resumeCount: 5 });
    expect(capturedUrl).toContain('resumeCount=5');
  });

  it('throws on a non-404 error status from JobAgentSearch', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      return { status: 500, body: 'boom' };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    await expect(client.searchCandidates('42')).rejects.toThrow(/searchCandidates failed: 500/);
  });

  it('maps a job and returns null for an unknown job number', async () => {
    // Pins the live-verified contract (2026-07-22, job 23-00053): JobDetail is
    // queried by `jobdivaref` (the agency-facing job number), wraps rows in
    // `{ data: [...] }`, and uses JobDiva's ALL-CAPS BI field names. SKILLS is a
    // boolean search string, not a delimited list, so it must be split on AND/OR.
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('jobdivaref=bad-number')) return { status: 404, body: 'nope' };
      return {
        body: {
          data: [{
            JOBTITLE: 'Platform Engineer',
            JOBDESCRIPTION: 'Build <b>platforms</b>.<br />Ship things.',
            SKILLS: '(KUBERNETES ) AND (GO )',
            POSITIONTYPE: 'Contract',
          }],
        },
      };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    const job = await client.getJob('23-00053');
    expect(job).toMatchObject({
      title: 'Platform Engineer',
      description: 'Build platforms . Ship things.',
      kind: 'contract',
      must_haves: ['KUBERNETES', 'GO'],
    });
    expect(await client.getJob('bad-number')).toBeNull();
  });

  it('maps direct-hire jobs and defaults must_haves when SKILLS is absent', async () => {
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      return { body: { data: [{ JOBTITLE: 'Recruiter', POSITIONTYPE: 'Direct Hire' }] } };
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    const job = await client.getJob('23-00099');
    expect(job).toMatchObject({ title: 'Recruiter', kind: 'direct_hire', must_haves: [], description: null });
  });

  it('returns null when a candidate has no resume', async () => {
    // getResumeText chains two BI calls: CandidateResumesDetail(candidateId) to find
    // a resume id, then ResumesTextDetail(resumeIds) for the text. No resume rows
    // means no id to look up, so it must stop after the first call.
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('/apiv2/bi/CandidateResumesDetail')) return { body: { data: [] } };
      throw new Error('should not call ResumesTextDetail with no resume id');
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    expect(await client.getResumeText('123')).toBeNull();
  });

  it('resolves resume text via CandidateResumesDetail -> ResumesTextDetail', async () => {
    // Pins the live-verified contract (2026-07-22, job 23-00053): RESUMEID is a
    // composite string (e.g. "123_45_1"), and the text call returns it under
    // PLAINTEXT (not RESUMETEXT/resumeText), keyed to the resumeIds "multi" param.
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/api/authenticate')) return { body: 'tok' };
      if (url.includes('/apiv2/bi/CandidateResumesDetail')) {
        expect(url).toContain('candidateId=20172402054704');
        return { body: { data: [{ CANDIDATEID: '20172402054704', RESUMEID: '20172402054704_529_1' }] } };
      }
      if (url.includes('/apiv2/bi/ResumesTextDetail')) {
        expect(url).toContain('resumeIds=20172402054704_529_1');
        return { body: { data: [{ GLOBAL_ID: '20172402054704_529_1', PLAINTEXT: ' Some resume text ' }] } };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const client = makeJobDivaClient({ ...CFG, fetchFn });
    expect(await client.getResumeText('20172402054704')).toBe('Some resume text');
  });
});
