import { describe, it, expect } from 'vitest';
import { hashApiKey } from '../../src/lib/agent-auth';
import { generateAgentKey } from './create-agent-key';

describe('generateAgentKey', () => {
  it('produces a 64-char hex plaintext and a matching sha256 hash', () => {
    const { plaintext, hash } = generateAgentKey();
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is non-deterministic across calls', () => {
    const a = generateAgentKey();
    const b = generateAgentKey();
    expect(a.plaintext).not.toBe(b.plaintext);
  });

  it('hash matches the real hashApiKey used at auth time, not a reimplementation', () => {
    const { plaintext, hash } = generateAgentKey();
    expect(hash).toBe(hashApiKey(plaintext));
  });
});
