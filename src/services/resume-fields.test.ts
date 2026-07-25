import { describe, it, expect } from 'vitest';
import { extractCandidateFields } from './resume-fields';

describe('extractCandidateFields', () => {
  it('parses a well-formed JSON completion into fields', async () => {
    const complete = async () => JSON.stringify({
      full_name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-1234',
      current_title: 'Engineer', location: 'London',
    });
    const f = await extractCandidateFields('resume text', complete);
    expect(f.full_name).toBe('Ada Lovelace');
    expect(f.email).toBe('ada@example.com');
    expect(f.location).toBe('London');
  });

  it('tolerates JSON wrapped in markdown fences', async () => {
    const complete = async () =>
      '```json\n{"full_name":"Bo","email":null,"phone":null,' +
      '"current_title":null,"location":null}\n```';
    const f = await extractCandidateFields('x', complete);
    expect(f.full_name).toBe('Bo');
    expect(f.email).toBeNull();
  });

  it('returns all-null fields (never throws) on unparseable output', async () => {
    const complete = async () => 'I could not find any fields, sorry!';
    const f = await extractCandidateFields('x', complete);
    expect(f).toEqual({
      full_name: null, email: null, phone: null, current_title: null, location: null,
    });
  });
});
