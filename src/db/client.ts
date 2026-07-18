import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv, poolMax } from '../lib/env';
import * as schema from './schema';

const queryClient = postgres(getEnv('DATABASE_URL'), {
  max: poolMax(process.env.DB_POOL_MAX),
});
export const db = drizzle(queryClient, { schema });
