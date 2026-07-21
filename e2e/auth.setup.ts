import { test as setup } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Email').fill('rick@sundayaiwork.com');
  await page.getByPlaceholder('Password').fill('change-me-locally');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
