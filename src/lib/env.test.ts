import { describe, it, expect, afterEach } from 'vitest';
import { getEnv, poolMax } from './env';

describe('getEnv', () => {
  afterEach(() => { delete process.env.AUTH_SECRET; });

  it('returns the value when set', () => {
    process.env.AUTH_SECRET = 'secret';
    expect(getEnv('AUTH_SECRET')).toBe('secret');
  });

  it('throws a named error when missing', () => {
    delete process.env.AUTH_SECRET;
    expect(() => getEnv('AUTH_SECRET')).toThrow('Missing required env var: AUTH_SECRET');
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
