import type { NextAuthConfig, Session } from 'next-auth';

export const authConfig = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [], // real provider added in auth.ts; middleware never runs authorize
  callbacks: {
    authorized({ auth, request }) {
      if (request.nextUrl.pathname.startsWith('/login')) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.org_id = (user as { org_id: string }).org_id;
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.org_id = token.org_id as string;
      session.user.role = token.role as Session['user']['role'];
      return session;
    },
  },
} satisfies NextAuthConfig;
