const { defineConfig, devices } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');
// Shared only with test workers so security fixtures can seed the isolated test database.
const testData =
  process.env.INKWELL_UI_DATA ||
  (process.env.INKWELL_UI_DATA = path.join(os.tmpdir(), 'inkwell-ui-' + Date.now()));
module.exports = defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  timeout: 15000,
  expect: { timeout: 3000 },
  use: {
    actionTimeout: 5000,
    navigationTimeout: 5000,
    baseURL: 'http://127.0.0.1:8877',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'uv run python -m inkwell --port 8877',
    url: 'http://127.0.0.1:8877',
    env: {
      INKWELL_DATA_DIR: testData,
      INKWELL_ACCESS_KEY: '',
      INKWELL_HOSTS: '',
    },
    reuseExistingServer: false,
  },
});
