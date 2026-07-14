import { describe, it, expect } from 'vitest';
import { authConfig } from './auth.config';

// The callbacks are pure functions — test them directly, no next-auth runtime needed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cb = authConfig.callbacks as any;

const req = (path: string) => ({ nextUrl: new URL(`http://localhost:3000${path}`) });

describe('authorized callback', () => {
  it('allows /login without a session', () => {
    expect(cb.authorized({ auth: null, request: req('/login') })).toBe(true);
  });

  it('blocks the queue and ATS pages without a session', () => {
    expect(cb.authorized({ auth: null, request: req('/') })).toBe(false);
    expect(cb.authorized({ auth: null, request: req('/jobs') })).toBe(false);
  });

  it('allows pages with a session', () => {
    expect(cb.authorized({ auth: { user: { id: 'u1' } }, request: req('/') })).toBe(true);
  });
});

describe('jwt + session callbacks', () => {
  it('copies id, org_id, and role from user → token → session', () => {
    const token = cb.jwt({ token: {}, user: { id: 'u1', org_id: 'o1', role: 'admin' } });
    expect(token.id).toBe('u1');
    expect(token.org_id).toBe('o1');
    expect(token.role).toBe('admin');
    const session = cb.session({ session: { user: {} }, token });
    expect(session.user.id).toBe('u1');
    expect(session.user.org_id).toBe('o1');
    expect(session.user.role).toBe('admin');
  });

  it('leaves an existing token untouched when no user is present', () => {
    const token = cb.jwt({ token: { id: 'u1', org_id: 'o1', role: 'admin' } });
    expect(token.id).toBe('u1');
  });
});
