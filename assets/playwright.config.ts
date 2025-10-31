import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for node-drive E2E tests
 *
 * Supports both local testing and VPS deployment testing:
 * - Local: `pnpm test` (auto-starts server)
 * - VPS: `VPS_URL=http://your-vps:8080 pnpm test` (tests against live server)
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run tests sequentially to avoid conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 3 : 0, // More retries in CI for network flakiness
  workers: 1, // Single worker to avoid race conditions with file operations

  // Longer timeout for VPS tests
  timeout: process.env.VPS_URL ? 60000 : 30000,

  reporter: process.env.CI ? [
    ['html'],
    ['list'],
    ['json', { outputFile: 'playwright-results.json' }]
  ] : 'html',

  use: {
    // Use VPS_URL if provided, otherwise local server
    baseURL: process.env.VPS_URL || 'http://127.0.0.1:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',

    // Longer timeouts for VPS testing
    navigationTimeout: process.env.VPS_URL ? 30000 : 15000,
    actionTimeout: process.env.VPS_URL ? 15000 : 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Only start local server if not testing against VPS
  webServer: process.env.VPS_URL ? undefined : {
    command: 'cd .. && mkdir -p /tmp/node-drive-test-$$ && cargo run -- /tmp/node-drive-test-$$ -p 5000',
    url: 'http://127.0.0.1:5000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
