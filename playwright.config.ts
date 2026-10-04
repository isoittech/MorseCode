import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:17632',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 17632 --no-proxy-headers',
    url: 'http://127.0.0.1:17632/api/health',
    reuseExistingServer: false,
    env: { MORSE_DEMO_ENABLED: 'true', MORSE_DATABASE_PATH: '.local/e2e.sqlite3' },
    timeout: 20_000,
  },
});
