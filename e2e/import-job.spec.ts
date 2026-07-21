import { test, expect } from '@playwright/test';

test('recruiter imports a JobDiva job by number and sourcing auto-starts', async ({ page }) => {
  await page.goto('/jobs');
  await page.getByPlaceholder('JobDiva job #').fill(`JD-${Date.now()}`);
  await page.getByRole('button', { name: 'Source' }).click();

  await page.waitForURL(/\/jobs\/[0-9a-f-]+\?source=1/);
  await expect(page.getByRole('heading', { name: /Imported: Platform Engineer/ })).toBeVisible();
  // Auto-started run shows progress, then completes.
  await expect(page.locator('.shortlist-card').first()).toBeVisible({ timeout: 30_000 });
});
