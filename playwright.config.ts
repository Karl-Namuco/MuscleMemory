import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13 Pro Max'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    env: { VITE_USE_EMULATORS: 'true', VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1' },
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
})
