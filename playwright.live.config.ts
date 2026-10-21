import { defineConfig, devices } from '@playwright/test'

const url = process.env.SUPABASE_TEST_URL
const key = process.env.SUPABASE_TEST_PUBLISHABLE_KEY
if (!url || !key || !process.env.SUPABASE_TEST_SECRET_KEY || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Live browser checks require privately configured local Supabase test credentials.')
}

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'auth-live.spec.ts', workers: 1, fullyParallel: false, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: {
    command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key },
  },
  projects: [
    { name: 'desktop-live', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-live', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
})
