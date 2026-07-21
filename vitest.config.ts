import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node', // DB/API tests stay in node; component tests opt into jsdom per-file
    globals: true, // required for @testing-library/react's automatic afterEach(cleanup)
    include: ['src/**/*.test.{ts,tsx}', 'n8n/**/*.test.ts', 'scripts/**/*.test.ts'],
    setupFiles: ['dotenv/config', './vitest.setup.ts'],
    env: { DOTENV_CONFIG_PATH: '.env.local' },
  },
});
