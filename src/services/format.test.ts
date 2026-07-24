import { describe, it, expect } from 'vitest';
import { formatForEmbedding } from './format';

describe('formatForEmbedding', () => {
  it('strips per-line trailing whitespace', () => {
    expect(formatForEmbedding('Senior Dev   \nReact   ')).toBe('Senior Dev\nReact');
  });

  it('collapses runs of 2+ spaces to one', () => {
    expect(formatForEmbedding('React    Developer')).toBe('React Developer');
  });

  it('maps en/em dashes to hyphen and curly quotes to straight', () => {
    expect(formatForEmbedding('2020 – 2024 “React” ‘dev’'))
      .toBe('2020 - 2024 "React" \'dev\'');
  });

  it('collapses 3+ newlines to 2 but preserves single and double newlines', () => {
    expect(formatForEmbedding('A\n\n\n\nB')).toBe('A\n\nB');
    expect(formatForEmbedding('A\n\nB\nC')).toBe('A\n\nB\nC');
  });

  it('tidies the double space that URL-stripping leaves behind', () => {
    expect(formatForEmbedding('Portfolio:  and ')).toBe('Portfolio: and');
  });

  it('returns empty string for empty input without throwing', () => {
    expect(formatForEmbedding('')).toBe('');
  });
});
