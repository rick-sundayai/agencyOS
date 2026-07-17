import { describe, it, expect } from 'vitest';
import { chunkText, sha256 } from './chunk';

describe('chunkText', () => {
  it('chunks with overlap and covers the whole text', () => {
    const text = 'x'.repeat(4000);
    const chunks = chunkText(text);
    expect(chunks[0]).toHaveLength(1500);
    expect(chunks.length).toBe(3); // 0-1500, 1300-2800, 2600-4000
    expect(chunks[1].slice(0, 200)).toBe(chunks[0].slice(1300));
  });
  it('short text is a single chunk', () => {
    expect(chunkText('short')).toEqual(['short']);
  });
});

describe('sha256', () => {
  it('is deterministic hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
