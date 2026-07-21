// JobDiva REST client. One deep module: token auth + refresh, endpoint shapes, and
// response mapping live here; callers see only getJob / searchCandidates / getResumeText.

export type JobDivaJob = {
  title: string;
  description: string | null;
  must_haves: string[];
  nice_to_haves: string[];
  kind: 'contract' | 'direct_hire';
};

export type JobDivaCandidate = {
  jobdiva_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  current_title: string | null;
  location: string | null;
};

export type JobDivaClient = {
  getJob(jobNumber: string): Promise<JobDivaJob | null>;
  searchCandidates(q: { title: string; mustHaves: string[]; location?: string }): Promise<JobDivaCandidate[]>;
  getResumeText(jobdivaCandidateId: string): Promise<string | null>;
};

// Best-known JobDiva REST surface — verify against the account's live Swagger before
// first production use (see jobdiva-smoke.ts). Paths are config, the interface is not.
const ENDPOINTS = {
  auth: '/api/authenticate',
  getJob: '/apiv2/jobdiva/getJobById',
  searchCandidates: '/apiv2/jobdiva/searchCandidateProfile',
  getResume: '/apiv2/jobdiva/getCandidateResume',
};

export function makeJobDivaClient(cfg: {
  clientId: string;
  username: string;
  password: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}): JobDivaClient {
  const base = (cfg.baseUrl ?? 'https://api.jobdiva.com').replace(/\/$/, '');
  const fetchFn = cfg.fetchFn ?? fetch;
  let token: string | null = null;

  async function authenticate(): Promise<string> {
    const qs = new URLSearchParams({
      clientid: cfg.clientId, username: cfg.username, password: cfg.password,
    });
    const res = await fetchFn(`${base}${ENDPOINTS.auth}?${qs}`);
    if (!res.ok) throw new Error(`jobdiva auth failed: ${res.status}`);
    token = (await res.text()).trim().replace(/^"|"$/g, '');
    return token;
  }

  // All JobDiva calls funnel through here: attach bearer token, re-auth exactly once
  // on 401, surface everything else as an error the caller can soft-handle.
  async function request(path: string, params: Record<string, string>): Promise<Response> {
    const tk = token ?? await authenticate();
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    let res = await fetchFn(url, { headers: { authorization: `Bearer ${tk}` } });
    if (res.status === 401) {
      const fresh = await authenticate();
      res = await fetchFn(url, { headers: { authorization: `Bearer ${fresh}` } });
    }
    return res;
  }

  return {
    async getJob(jobNumber) {
      const res = await request(ENDPOINTS.getJob, { jobId: jobNumber });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`jobdiva getJob failed: ${res.status}`);
      const data = await res.json() as Array<Record<string, unknown>>;
      const j = Array.isArray(data) ? data[0] : data;
      if (!j) return null;
      const skills = Array.isArray(j.skills) ? (j.skills as string[]) : [];
      return {
        title: String(j.title ?? `JobDiva job ${jobNumber}`),
        description: j.description != null ? String(j.description) : null,
        must_haves: skills,
        nice_to_haves: [],
        kind: String(j.jobType ?? '').toLowerCase().includes('direct') ? 'direct_hire' : 'contract',
      };
    },

    async searchCandidates(q) {
      const keywords = [q.title, ...q.mustHaves].filter(Boolean).join(' ');
      const params: Record<string, string> = { keywords, maxreturned: '50' };
      if (q.location) params.location = q.location;
      const res = await request(ENDPOINTS.searchCandidates, params);
      if (!res.ok) throw new Error(`jobdiva searchCandidates failed: ${res.status}`);
      const data = await res.json() as Array<Record<string, unknown>>;
      return (Array.isArray(data) ? data : []).map((c) => ({
        jobdiva_id: String(c.id),
        full_name: [c.firstName, c.lastName].filter(Boolean).join(' ') || String(c.id),
        email: c.email != null ? String(c.email) : null,
        phone: c.phone != null ? String(c.phone) : null,
        current_title: c.currentTitle != null ? String(c.currentTitle) : null,
        location: c.city != null ? String(c.city) : null,
      }));
    },

    async getResumeText(jobdivaCandidateId) {
      const res = await request(ENDPOINTS.getResume, { candidateid: jobdivaCandidateId });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`jobdiva getResume failed: ${res.status}`);
      const data = await res.json() as Array<{ resumeText?: string }> | { resumeText?: string };
      const first = Array.isArray(data) ? data[0] : data;
      const text = first?.resumeText?.trim();
      return text ? text : null;
    },
  };
}

export function defaultJobDivaClient(): JobDivaClient {
  const clientId = process.env.JOBDIVA_CLIENT_ID;
  const username = process.env.JOBDIVA_USERNAME;
  const password = process.env.JOBDIVA_PASSWORD;
  if (!clientId || !username || !password) {
    throw new Error('jobdiva: set JOBDIVA_CLIENT_ID, JOBDIVA_USERNAME, JOBDIVA_PASSWORD');
  }
  return makeJobDivaClient({
    clientId, username, password, baseUrl: process.env.JOBDIVA_BASE_URL,
  });
}
