import { describe, it, expect, afterEach } from 'vitest';
import { getEnv, poolMax } from './env';

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

describe('poolMax', () => {
  it('parses a positive integer', () => {
    expect(poolMax('5')).toBe(5);
  });
  it('defaults to 10 when unset', () => {
    expect(poolMax(undefined)).toBe(10);
  });
  it('defaults to 10 on garbage or non-positive values', () => {
    expect(poolMax('abc')).toBe(10);
    expect(poolMax('0')).toBe(10);
    expect(poolMax('-3')).toBe(10);
    expect(poolMax('2.5')).toBe(10);
  });
});
