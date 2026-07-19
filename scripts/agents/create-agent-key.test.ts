import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateAgentKey } from './create-agent-key';

describe('generateAgentKey', () => {
  it('produces a 64-char hex plaintext and a matching sha256 hash', () => {
    const { plaintext, hash } = generateAgentKey();
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(plaintext).digest('hex')).toBe(hash);
  });

  it('is non-deterministic across calls', () => {
    const a = generateAgentKey();
    const b = generateAgentKey();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});
