import { describe, it, expect } from 'vitest';
import { redactForEmbedding, redactForLLM } from './redact';

describe('redactForEmbedding', () => {
  it('replaces email addresses with [EMAIL]', () => {
    expect(redactForEmbedding('Contact: jane.doe+ats@example.co.uk for details'))
      .toBe('Contact: [EMAIL] for details');
  });

  it('replaces common US phone formats with [PHONE]', () => {
    expect(redactForEmbedding('Call (555) 555-5555 or 555-555-5555 or +1 555.555.5555'))
      .toBe('Call [PHONE] or [PHONE] or [PHONE]');
  });

  it('strips http(s) and bare www URLs entirely', () => {
    expect(redactForEmbedding('Portfolio: https://example.com/jane and www.linkedin.com/in/jane'))
      .toBe('Portfolio:  and ');
  });

  it('normalizes text to NFKC', () => {
    // 'Ａ' is fullwidth 'A' (NFKC-normalizes to ascii 'A')
    expect(redactForEmbedding('ＡBC')).toBe('ABC');
  });

  it('passes non-PII text through unchanged', () => {
    expect(redactForEmbedding('Senior React Developer with 5 years experience'))
      .toBe('Senior React Developer with 5 years experience');
  });

  it('returns empty string for null/empty input without throwing', () => {
    expect(redactForEmbedding('')).toBe('');
    expect(redactForEmbedding(null)).toBe(null);
  });
});

describe('redactForLLM', () => {
  it('replaces every token of the full name, case-insensitively, whole-word', () => {
    expect(redactForLLM('Jane Doe worked at Acme. jane called doe about DOE Corp.', 'Jane Doe'))
      .toBe('[NAME] worked at Acme. [NAME] called [NAME] about [NAME] Corp.');
  });

  it('collapses repeated [NAME] tokens', () => {
    expect(redactForLLM('Jane Doe is a developer', 'Jane Doe')).toBe('[NAME] is a developer');
  });

  it('escapes regex-special characters in a name token without breaking the match', () => {
    expect(redactForLLM('Reached out to St. Clair about the role.', 'Jane St. Clair'))
      .toBe('Reached out to [NAME] about the role.');
  });

  it('skips name tokens shorter than 2 characters', () => {
    expect(redactForLLM('J Smith led the project. J was great.', 'J Smith'))
      .toBe('J [NAME] led the project. J was great.');
  });

  it('neutralizes gendered pronouns', () => {
    expect(redactForLLM(
      'She led the team. He helped her with his notes. Him and hers. She hurt herself. He hurt himself.',
      'Jane Doe',
    )).toBe(
      'They led the team. They helped their with their notes. Them and theirs. They hurt themself. They hurt themself.',
    );
  });

  it('also applies the embedding-tier redactions (email/phone/url)', () => {
    expect(redactForLLM('Jane Doe: jane@example.com, (555) 555-5555', 'Jane Doe'))
      .toBe('[NAME]: [EMAIL], [PHONE]');
  });

  it('returns empty string for null/empty input without throwing', () => {
    expect(redactForLLM('', 'Jane Doe')).toBe('');
    expect(redactForLLM(null, 'Jane Doe')).toBe(null);
  });
});
