import { test, expect } from '@playwright/test';

test('recruiter sources candidates from the job page', async ({ page }) => {
  await page.goto('/jobs');
  await page.locator('.jo-card').first().click();

  await page.getByRole('button', { name: /source candidates|retry/i }).click();

  // Phase progress appears, then the shortlist.
  await expect(page.locator('.sourcing-status')).toBeVisible();
  await expect(page.locator('.shortlist-card').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/E2E Ada/)).toBeVisible();

  // The pipeline board gains sourced cards after the auto-refresh.
  await expect(
    page.locator('.pipeline-col.stage-sourced .pipeline-card').first(),
  ).toBeVisible({ timeout: 15_000 });
});
