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

// JobDiva REST surface. Live-verified 2026-07-22 against production (job 23-00053):
// the `/apiv2/jobdiva/*` namespace this file previously guessed at doesn't exist
// (404s outright). `/api/authenticate` and the `/apiv2/bi/*` "BI" namespace (also
// used by scripts/migration/jobdiva-client.ts) are real. BI responses wrap rows in
// `{ data: [...] }` (or occasionally a bare array) with ALL-CAPS field names.
//
// getJob is confirmed working: JobDetail accepts the agency-facing job number
// directly via `jobdivaref` (no separate internal-id lookup needed).
//
// searchCandidates and getResume remain UNVERIFIED. The BI namespace only exposes
// by-ID "Detail" lookups (CandidateDetail requires a numeric candidateId) and
// date-windowed "NewUpdated*Records" listings (capped at a 14-day range per call) —
// no keyword/criteria search was found. Attempted and confirmed 404:
// /apiv2/candidate/searchcandidate, /apiv2/bi/SearchCandidate, /apiv2/bi/CandidateSearch.
// Before relying on searchCandidates in production, either get JobDiva's official
// API docs for a candidate-search endpoint, or redesign this to pull
// NewUpdatedCandidateRecords windows and match locally (see 2026-07-22 smoke-test
// report for the full trace).
const ENDPOINTS = {
  auth: '/api/authenticate',
  getJob: '/apiv2/bi/JobDetail',
  searchCandidates: '/apiv2/bi/CandidateSearch', // unverified — see comment above
  getResume: '/apiv2/bi/CandidateResumesDetail', // unverified — see comment above
};

// BI endpoints return either a bare array of rows or `{ data: [...] }`.
function biRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  const d = (data as { data?: unknown } | null)?.data;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
}

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

  const cleanHtml = (html: string | null | undefined): string | null => {
    if (!html) return null;
    const text = html.replace(/<[^>]*>?/gm, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
  };

  return {
    async getJob(jobNumber) {
      // JobDiva's BI JobDetail takes either the internal numeric `jobId` or the
      // agency-facing job number via `jobdivaref` — recruiters type the latter
      // (e.g. "23-00053"), confirmed live 2026-07-22.
      const res = await request(ENDPOINTS.getJob, { jobdivaref: jobNumber });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`jobdiva getJob failed: ${res.status}`);
      const rows = biRows(await res.json());
      const j = rows[0];
      if (!j) return null;
      // SKILLS on this account is a boolean search string ("(SALESFORCE OR ...) AND
      // (VISIO )"), not a delimited list — split on AND/OR and strip the parens.
      const skillsRaw = j.SKILLS != null ? String(j.SKILLS) : '';
      const skills = skillsRaw
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/\b(?:AND|OR)\b/i)
        .map((x) => x.trim())
        .filter(Boolean);
      return {
        title: String(j.JOBTITLE ?? `JobDiva job ${jobNumber}`),
        description: cleanHtml(j.JOBDESCRIPTION != null ? String(j.JOBDESCRIPTION) : null),
        must_haves: skills,
        nice_to_haves: [],
        kind: String(j.POSITIONTYPE ?? '').toLowerCase().includes('direct') ? 'direct_hire' : 'contract',
      };
    },

    async searchCandidates(q) {
      const keywords = [q.title, ...q.mustHaves].filter(Boolean).join(' ');
      const params: Record<string, string> = { keywords, maxreturned: '50' };
      if (q.location) params.location = q.location;
      const res = await request(ENDPOINTS.searchCandidates, params);
      if (!res.ok) throw new Error(`jobdiva searchCandidates failed: ${res.status}`);
      const data = biRows(await res.json());
      return data.map((c) => ({
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
