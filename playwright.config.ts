import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: [
    {
      command: 'node scripts/e2e/fake-n8n.mjs',
      port: 5679,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      env: {
        N8N_WEBHOOK_URL: 'http://localhost:5679/webhook',
        JOBDIVA_BASE_URL: 'http://localhost:5679/jobdiva',
        JOBDIVA_CLIENT_ID: 'e2e', JOBDIVA_USERNAME: 'e2e', JOBDIVA_PASSWORD: 'e2e',
      },
    },
  ],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { storageState: 'e2e/.auth/user.json' },
    },
  ],
});
