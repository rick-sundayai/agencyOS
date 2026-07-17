// JobDiva BI API client. The per-minute rate limit is undocumented and self-healing:
// protect with CONCURRENCY (all calls sequential) and backoff — never hourly caps,
// never parallel fan-out. (Project memory: jobdiva-api-rate-limit.)
const BASE = 'https://api.jobdiva.com';

export type BiRow = Record<string, unknown>;
export type JobDivaCreds = { clientid: string; username: string; password: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JobDivaClient {
  private token: string | null = null;

  constructor(private creds: JobDivaCreds = {
    clientid: process.env.JOBDIVA_CLIENT_ID ?? '',
    username: process.env.JOBDIVA_USERNAME ?? '',
    password: process.env.JOBDIVA_PASSWORD ?? '',
  }) {}

  // VERIFY at first live run: path confirmed against the live n8n "SundayAI — Auth — JobDiva"
  // workflow, which returns the full Authorization header value.
  async authenticate(): Promise<string> {
    const qs = new URLSearchParams(this.creds as unknown as Record<string, string>);
    const res = await fetch(`${BASE}/apiv2/v2/authenticate?${qs}`);
    if (!res.ok) throw new Error(`JobDiva auth failed: ${res.status}`);
    const body = (await res.text()).trim().replace(/^"|"$/g, '');
    this.token = body.startsWith('Bearer ') ? body : `Bearer ${body}`;
    return this.token;
  }

  async get(path: string, params: Record<string, string>): Promise<unknown> {
    if (!this.token) await this.authenticate();
    const url = `${BASE}${path}?${new URLSearchParams(params)}`;
    let delay = 2000;
    let reauthed = false;
    for (let attempt = 1; attempt <= 6; attempt++) {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: this.token! },
      });
      if (res.status === 401 && !reauthed) {
        reauthed = true;
        await this.authenticate();
        continue;
      }
      if (res.ok) return res.json();
      if (res.status === 429 || res.status >= 500) {
        await sleep(delay + Math.random() * 1000);
        delay = Math.min(delay * 2, 60_000);
        continue;
      }
      throw new Error(`JobDiva ${path} failed: ${res.status}`);
    }
    throw new Error(`JobDiva ${path}: retries exhausted`);
  }

  static rows(resp: unknown): BiRow[] {
    if (Array.isArray(resp)) return resp as BiRow[];
    const d = (resp as { data?: unknown } | null)?.data;
    return Array.isArray(d) ? (d as BiRow[]) : [];
  }

  // Dates: start with yyyy-MM-dd; capture-fixtures confirms the accepted format.
  newUpdatedJobRecords(fromDate: string, toDate: string) {
    return this.get('/apiv2/bi/NewUpdatedJobRecords', { fromDate, toDate });
  }
  // VERIFY at first live run: assumed symmetric with NewUpdatedJobRecords.
  newUpdatedCandidateRecords(fromDate: string, toDate: string) {
    return this.get('/apiv2/bi/NewUpdatedCandidateRecords', { fromDate, toDate });
  }
  jobDetail(jobId: string) { return this.get('/apiv2/bi/JobDetail', { jobId }); }
  candidateDetail(candidateId: string) { return this.get('/apiv2/bi/CandidateDetail', { candidateId }); }
  candidateResumes(candidateId: string) { return this.get('/apiv2/bi/CandidateResumesDetail', { candidateId }); }
  resumeDetail(resumeId: string) { return this.get('/apiv2/bi/ResumeDetail', { resumeId }); }
}
