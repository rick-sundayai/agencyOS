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
  // Runs JobDiva's own job-to-candidate matching (JobAgentSearch) for the given
  // agency-facing job number — not a free-text keyword search. Confirmed live
  // 2026-07-22 against production, per direct guidance on the real endpoint name.
  searchCandidates(jobNumber: string, opts?: { resumeCount?: number }): Promise<JobDivaCandidate[]>;
  getResumeText(jobdivaCandidateId: string): Promise<string | null>;
};

// JobDiva REST surface. Live-verified 2026-07-22 against production (job 23-00053),
// cross-checked against JobDiva's own live Swagger spec (fetched unauthenticated
// from /swagger-resources -> /swagger?group=Version 2). Two namespaces are real:
// `/apiv2/bi/*` ("BI" reports — by-ID "Detail" lookups and date-windowed
// "NewUpdated*Records" listings, ALL-CAPS fields, rows wrapped in `{ data: [...] }`
// or a bare array), and `/apiv2/jobdiva/*` (the ATS action/search API — this file's
// original guess at `getJobById` under this namespace 404'd because that specific
// *name* doesn't exist, not because the namespace is fake: `JobAgentSearch` does,
// per the spec, and per direct account confirmation of the real endpoint name).
//
// getJob: BI JobDetail, queried by the agency-facing job number via `jobdivaref`.
// searchCandidates: GET /apiv2/jobdiva/JobAgentSearch?jobId=<internal id>&resumeCount=N
// — JobDiva's own job-to-candidate matching for a specific job, not a free-text
// keyword search. It takes the *internal numeric* job id (not the agency-facing
// job number), so a job number input is resolved via JobDetail(jobdivaref) first,
// same as getJob. Response fields are ALL-CAPS (CANDIDATEID, FIRSTNAME, LASTNAME,
// PHONE, CITY, PROVINCE [state], ABSTRACT as a current-title-ish summary); no
// email field is included in the match summary.
// getResumeText: two BI calls chained, per the spec's separation of resume
// metadata from resume text — CandidateResumesDetail(candidateId) to get the
// candidate's resume id (RESUMEID, a composite string like "123_45_1"), then
// ResumesTextDetail(resumeIds) for the text, returned under PLAINTEXT.
const ENDPOINTS = {
  auth: '/api/authenticate',
  getJob: '/apiv2/bi/JobDetail',
  jobAgentSearch: '/apiv2/jobdiva/JobAgentSearch',
  candidateResumes: '/apiv2/bi/CandidateResumesDetail',
  resumesText: '/apiv2/bi/ResumesTextDetail',
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
  async function request(path: string, params: Record<string, string> | string): Promise<Response> {
    const tk = token ?? await authenticate();
    const qs = typeof params === 'string' ? params : new URLSearchParams(params).toString();
    const url = `${base}${path}?${qs}`;
    let res = await fetchFn(url, { headers: { authorization: `Bearer ${tk}` } });
    if (res.status === 401) {
      const fresh = await authenticate();
      res = await fetchFn(url, { headers: { authorization: `Bearer ${fresh}` } });
    }
    return res;
  }

  // JobDiva's "multi" collection format for array query params: repeat the key,
  // e.g. resumeIds=1&resumeIds=2.
  function multiParam(name: string, values: string[]): string {
    return values.map((v) => `${name}=${encodeURIComponent(v)}`).join('&');
  }

  const cleanHtml = (html: string | null | undefined): string | null => {
    if (!html) return null;
    const text = html.replace(/<[^>]*>?/gm, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return text || null;
  };

  // JobAgentSearch (and other /apiv2/jobdiva/* endpoints) take the internal
  // numeric JobDiva id, not the agency-facing job number — resolve via the same
  // BI JobDetail lookup getJob uses.
  async function resolveInternalJobId(jobNumberOrId: string): Promise<string | null> {
    if (/^\d+$/.test(jobNumberOrId)) return jobNumberOrId;
    const res = await request(ENDPOINTS.getJob, { jobdivaref: jobNumberOrId });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`jobdiva resolveInternalJobId failed: ${res.status}`);
    const rows = biRows(await res.json());
    const id = rows[0]?.ID;
    return id != null ? String(id) : null;
  }

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

    async searchCandidates(jobNumber, opts) {
      const internalId = await resolveInternalJobId(jobNumber);
      if (internalId == null) return [];
      const resumeCount = String(opts?.resumeCount ?? 0);
      const res = await request(ENDPOINTS.jobAgentSearch, { jobId: internalId, resumeCount });
      if (!res.ok) throw new Error(`jobdiva searchCandidates failed: ${res.status}`);
      const data = biRows(await res.json());
      const field = (row: Record<string, unknown>, ...names: string[]): unknown => {
        for (const n of names) if (row[n] != null) return row[n];
        return null;
      };
      return data.map((c) => {
        const id = field(c, 'id', 'ID', 'candidateId', 'CANDIDATEID');
        const city = field(c, 'city', 'CITY') as string | null;
        const state = field(c, 'state', 'STATE', 'PROVINCE') as string | null;
        return {
          jobdiva_id: String(id),
          full_name: [field(c, 'first name', 'firstName', 'FIRSTNAME'), field(c, 'last name', 'lastName', 'LASTNAME')]
            .filter(Boolean).join(' ') || String(id),
          email: field(c, 'email', 'EMAIL') as string | null,
          phone: field(c, 'phone 1', 'phone', 'PHONE', 'PHONE1') as string | null,
          current_title: field(c, 'title', 'currentTitle', 'TITLE', 'ABSTRACT') as string | null,
          location: [city, state].filter(Boolean).join(', ') || null,
        };
      });
    },

    async getResumeText(jobdivaCandidateId) {
      const resumesRes = await request(ENDPOINTS.candidateResumes, { candidateId: jobdivaCandidateId });
      if (resumesRes.status === 404) return null;
      if (!resumesRes.ok) throw new Error(`jobdiva getResume (resumes list) failed: ${resumesRes.status}`);
      const resumeRows = biRows(await resumesRes.json());
      const resumeId = resumeRows[0]?.RESUMEID ?? resumeRows[0]?.ID ?? resumeRows[0]?.resumeId;
      if (resumeId == null) return null;

      const textRes = await request(ENDPOINTS.resumesText, multiParam('resumeIds', [String(resumeId)]));
      if (textRes.status === 404) return null;
      if (!textRes.ok) throw new Error(`jobdiva getResume (text) failed: ${textRes.status}`);
      const textRows = biRows(await textRes.json());
      const row = textRows[0];
      const text = row?.PLAINTEXT ?? row?.RESUMETEXT ?? row?.resumeText ?? row?.TEXT;
      const trimmed = text != null ? String(text).trim() : '';
      return trimmed ? trimmed : null;
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
