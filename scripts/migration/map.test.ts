import { describe, it, expect } from 'vitest';
import { cleanHtml, mapCandidate, mapJob, pickLatestResume } from './map';

describe('cleanHtml', () => {
  it('strips tags and entities, collapses whitespace', () => {
    expect(cleanHtml('<p>Senior&nbsp;<b>Dev</b></p>\n\n needed')).toBe('Senior Dev needed');
  });
});

describe('mapCandidate', () => {
  const row = {
    ID: 12345, FIRSTNAME: ' Ada ', LASTNAME: 'Lovelace', EMAIL: 'ada@example.com',
    CELLPHONE: '555-0100', PHONE1: '555-0199', CITY: 'Boston', STATE: 'MA', COUNTRY: 'United States',
  };
  it('maps names, contact, and location', () => {
    expect(mapCandidate(row)).toEqual({
      jobdiva_id: '12345', full_name: 'Ada Lovelace', email: 'ada@example.com',
      phone: '555-0100', current_title: null, location: 'Boston, MA, United States', source: 'jobdiva',
    });
  });
  it('prefers CELLPHONE, falls back PHONE2 then PHONE1', () => {
    expect(mapCandidate({ ...row, CELLPHONE: null, PHONE2: '555-0111' }).phone).toBe('555-0111');
    expect(mapCandidate({ ...row, CELLPHONE: null }).phone).toBe('555-0199');
  });
  it('nulls a malformed email instead of failing the record', () => {
    expect(mapCandidate({ ...row, EMAIL: 'not-an-email' }).email).toBeNull();
  });
});

describe('mapJob', () => {
  it('cleans HTML and splits skills', () => {
    const j = mapJob({
      ID: 77, JOBTITLE: 'React Dev', COMPANYNAME: 'Acme',
      JOBDESCRIPTION: '<div>Build <b>apps</b></div>', SKILLS: 'React; TypeScript, AWS',
    });
    expect(j).toEqual({
      jobdiva_id: '77', title: 'React Dev', company_name: 'Acme',
      description: 'Build apps', must_haves: ['React', 'TypeScript', 'AWS'], kind: 'contract',
    });
  });
});

describe('pickLatestResume', () => {
  it('returns the id of the newest resume across date-field spellings', () => {
    expect(pickLatestResume([
      { RESUMEID: 1, DATERECEIVED: '2024-01-01' },
      { RESUMEID: 2, DATERECEIVED: '2026-05-01' },
    ])).toBe('2');
    expect(pickLatestResume([])).toBeNull();
  });
});
