import type { BiRow } from './jobdiva-client';

// Ported verbatim from the validated "Parse Job Order Details" n8n node.
export const cleanHtml = (html: string | null | undefined): string => {
  if (!html) return '';
  return html
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const s = (row: BiRow, key: string): string | null => {
  const v = row[key];
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

export function mapCandidate(row: BiRow) {
  const rawEmail = s(row, 'EMAIL');
  return {
    jobdiva_id: String(row.ID ?? row.CANDIDATEID ?? ''),
    full_name: [s(row, 'FIRSTNAME'), s(row, 'LASTNAME')].filter(Boolean).join(' ') || 'Unknown',
    email: rawEmail && /.+@.+\..+/.test(rawEmail) ? rawEmail : null,
    phone: s(row, 'CELLPHONE') ?? s(row, 'PHONE2') ?? s(row, 'PHONE1'),
    current_title: s(row, 'TITLE'),
    location: [s(row, 'CITY'), s(row, 'STATE'), s(row, 'COUNTRY')].filter(Boolean).join(', ') || null,
    source: 'jobdiva' as const,
  };
}

export function mapJob(row: BiRow) {
  return {
    jobdiva_id: String(row.ID ?? ''),
    title: s(row, 'JOBTITLE') ?? 'Untitled',
    company_name: s(row, 'COMPANYNAME'),
    description: cleanHtml(s(row, 'JOBDESCRIPTION')),
    must_haves: (s(row, 'SKILLS') ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean),
    // JobDiva's position-type field isn't reliably mapped (see ADR-0015's CHECK-column
    // precedent) — default to the agency's dominant book; correct per-order in the cockpit.
    kind: 'contract' as const,
  };
}

export function pickLatestResume(rows: BiRow[]): string | null {
  if (rows.length === 0) return null;
  const dateOf = (r: BiRow) =>
    new Date(String(r.DATERECEIVED ?? r.DATECREATED ?? r.MODIFIEDDATE ?? 0)).getTime() || 0;
  const latest = [...rows].sort((a, b) => dateOf(b) - dateOf(a))[0];
  const id = latest.RESUMEID ?? latest.ID;
  return id == null ? null : String(id);
}
