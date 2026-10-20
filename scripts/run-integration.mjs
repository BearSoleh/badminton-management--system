import { spawnSync } from 'node:child_process'

const url = process.env.SUPABASE_TEST_URL
if (!url || !process.env.SUPABASE_TEST_PUBLISHABLE_KEY || !process.env.SUPABASE_TEST_SECRET_KEY) {
  console.error('Supabase integration tests NOT RUN: start local Supabase (Docker required), apply migrations, and set SUPABASE_TEST_URL, SUPABASE_TEST_PUBLISHABLE_KEY and SUPABASE_TEST_SECRET_KEY. See docs/OPERATIONS.md. No credentials are printed.')
  process.exit(1)
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
  console.error('Integration tests refuse a non-local backend. Use synthetic data in local Supabase.')
  process.exit(1)
}
try {
  const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: process.env.SUPABASE_TEST_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error('unavailable')
} catch {
  console.error('Supabase integration tests NOT RUN: the configured local Auth service is unavailable. Run npm run db:start first.')
  process.exit(1)
}
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--project', 'integration'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
