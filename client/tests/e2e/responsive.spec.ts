import { test, expect } from '@playwright/test';

test('mobile: navigation drawer opens and pages fit the viewport', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@dialstack.dev');
  await page.getByLabel('Password').fill('Demo1234!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Leads', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
