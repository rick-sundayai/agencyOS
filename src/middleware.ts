import NextAuth from 'next-auth';
import { authConfig } from './lib/auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  // Everything needs a session except: next-auth's own routes, the agent API
  // (API-key authed), and static assets. /login is allowed by the authorized callback.
  matcher: ['/((?!api/auth|api/agent|_next/static|_next/image|favicon.ico).*)'],
};
