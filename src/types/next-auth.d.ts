import 'next-auth';
import type { Role } from '../contracts/decision';

declare module 'next-auth' {
  interface User {
    org_id: string;
    role: Role;
  }
  interface Session {
    user: {
      id: string;
      org_id: string;
      role: Role;
      email?: string | null;
      name?: string | null;
    };
  }
}
