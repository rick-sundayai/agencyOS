import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { verifyUser } from './credentials';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = typeof creds?.email === 'string' ? creds.email : '';
        const password = typeof creds?.password === 'string' ? creds.password : '';
        if (!email || !password) return null;
        return verifyUser(email, password);
      },
    }),
  ],
});
