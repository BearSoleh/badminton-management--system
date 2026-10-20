import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { projects: [
  { test: { name: 'unit', include: ['tests/domain/**/*.test.ts'] } },
  { test: { name: 'database', include: ['tests/database/**/*.test.ts'], testTimeout: 20000, hookTimeout: 30000, fileParallelism: false } },
  { test: { name: 'integration', include: ['tests/integration/**/*.spec.ts'], testTimeout: 20000, hookTimeout: 20000, fileParallelism: false } },
] } })
