import { describe, it, expect, afterEach } from 'vitest';
import { getEnv } from './env';

describe('getEnv', () => {
  afterEach(() => { delete process.env.AGENT_API_KEY; });

  it('returns the value when set', () => {
    process.env.AGENT_API_KEY = 'secret';
    expect(getEnv('AGENT_API_KEY')).toBe('secret');
  });

  it('throws a named error when missing', () => {
    delete process.env.AGENT_API_KEY;
    expect(() => getEnv('AGENT_API_KEY')).toThrow('Missing required env var: AGENT_API_KEY');
  });
});
