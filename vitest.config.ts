import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { toTestDatabaseUrl } from './src/test/test-db';

loadEnv({ path: '.env.local' });

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node', // DB/API tests stay in node; component tests opt into jsdom per-file
    globals: true, // required for @testing-library/react's automatic afterEach(cleanup)
    include: ['src/**/*.test.{ts,tsx}', 'n8n/**/*.test.ts', 'scripts/**/*.test.ts'],
    setupFiles: ['dotenv/config', './vitest.setup.ts'],
    globalSetup: './vitest.global-setup.ts',
    env: {
      DOTENV_CONFIG_PATH: '.env.local',
      // Point every worker at the dedicated test database. dotenv/config in setupFiles
      // never overrides an already-set var, so the dev DATABASE_URL can't leak back in.
      ...(process.env.DATABASE_URL
        ? { DATABASE_URL: toTestDatabaseUrl(process.env.DATABASE_URL) }
        : {}),
    },
  },
});
