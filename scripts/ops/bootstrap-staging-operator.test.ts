import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { generateOperatorPassword } from './bootstrap-staging-operator';

describe('generateOperatorPassword', () => {
  it('produces a plaintext password and a bcrypt hash that verifies it', () => {
    const { plaintext, hash } = generateOperatorPassword();
    expect(plaintext.length).toBeGreaterThan(10);
    expect(bcrypt.compareSync(plaintext, hash)).toBe(true);
  });

  it('is non-deterministic across calls', () => {
    const a = generateOperatorPassword();
    const b = generateOperatorPassword();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});
