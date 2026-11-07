import { defineConfig, devices } from '@playwright/test';

// Set PW_CHROMIUM_PATH to reuse an existing Chromium instead of `npx playwright install`.
const launchOptions = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4000';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chromium', launchOptions }, testIgnore: /responsive/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chromium', launchOptions }, testMatch: /responsive/ },
  ],
  // Boots the API (serving the built SPA) on an in-memory MongoDB with demo data unless E2E_BASE_URL is set.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run build && cd ../server && npx tsx src/scripts/demo.ts',
    url: 'http://localhost:4000/api/health',
    timeout: 240_000,
    reuseExistingServer: true,
  },
});
