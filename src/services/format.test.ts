import { describe, it, expect } from 'vitest';
import { formatForEmbedding, chunkForEmbedding } from './format';

describe('formatForEmbedding', () => {
  it('strips per-line trailing whitespace', () => {
    expect(formatForEmbedding('Senior Dev   \nReact   ')).toBe('Senior Dev\nReact');
  });

  it('collapses runs of 2+ spaces to one', () => {
    expect(formatForEmbedding('React    Developer')).toBe('React Developer');
  });

  it('maps en/em dashes to hyphen and curly quotes to straight', () => {
    expect(formatForEmbedding('2020 – 2024 "React" \'dev\''))
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

describe('chunkForEmbedding', () => {
  it('returns an empty array for empty input', () => {
    expect(chunkForEmbedding('')).toEqual([]);
  });

  it('returns a single chunk when the text fits under the target', () => {
    const t = 'A short resume under the target size.';
    expect(chunkForEmbedding(t)).toEqual([t]);
  });

  it('splits oversized text into multiple chunks without cutting mid-word', () => {
    const text = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkForEmbedding(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1700);   // target 1500 + overlap 200
      expect(c).toMatch(/^word\d+/);                 // starts at a whole token
      expect(c.trimEnd()).toMatch(/word\d+$/);       // ends at a whole token
    }
  });

  it('carries word-boundary overlap between adjacent prose chunks', () => {
    const text = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkForEmbedding(text);
    const firstTokenOfSecond = chunks[1].split(' ')[0];
    expect(chunks[0].includes(firstTokenOfSecond)).toBe(true);
  });

  it('starts a new chunk at an ALL-CAPS section header, with no cross-section overlap', () => {
    const summary = 'Summary line. '.repeat(80);
    const experience = 'Did work. '.repeat(80);
    const text = `${summary}\nPROFESSIONAL EXPERIENCE\n${experience}`;
    const chunks = chunkForEmbedding(text);
    const headerChunk = chunks.find((c) => c.includes('PROFESSIONAL EXPERIENCE'));
    expect(headerChunk).toBeDefined();
    expect(headerChunk!.trimStart().startsWith('PROFESSIONAL EXPERIENCE')).toBe(true);
  });

  it('hard-splits a single unit longer than the target as a last resort', () => {
    const chunks = chunkForEmbedding('x'.repeat(4000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1700)).toBe(true);
  });
});
