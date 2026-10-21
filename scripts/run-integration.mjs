import { spawnSync } from 'node:child_process'

const url = process.env.SUPABASE_TEST_URL
if (!url || !process.env.SUPABASE_TEST_PUBLISHABLE_KEY || !process.env.SUPABASE_TEST_SECRET_KEY || !process.env.SUPABASE_TEST_JWT_SECRET) {
  console.error('Supabase integration tests NOT RUN: start local Supabase (Docker required), apply migrations, and privately set the four SUPABASE_TEST_ variables from .env.test.example. See docs/OPERATIONS.md. No credentials are printed.')
  process.exit(1)
}
let localBackend = false
try {
  const parsed = new URL(url)
  localBackend = ['http:', 'https:'].includes(parsed.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && parsed.port === '54321' && parsed.pathname === '/' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
} catch { /* Never echo malformed credential-bearing configuration. */ }
if (!localBackend) {
  console.error('Integration tests require the local BJBC API on loopback port 54321. Trusted SQL fixtures target only the supabase_db_bjbc container.')
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
