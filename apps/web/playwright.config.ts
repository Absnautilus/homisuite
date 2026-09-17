import { defineConfig, devices } from '@playwright/test'

// CI runs the authenticated suite against its disposable local Supabase
// stack. The same setup can be reproduced locally; see docs/e2e-testing.md.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
