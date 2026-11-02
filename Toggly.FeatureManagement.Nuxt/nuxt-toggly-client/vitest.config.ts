import { defineConfig } from 'vitest/config'

// Node 25+ ships a built-in localStorage accessor that shadows happy-dom's
// Storage unless Web Storage is disabled for the worker. Vitest 3 only
// forwards poolOptions.*.execArgv (not top-level test.execArgv) into forks/
// threads, so set the flag there. Gate it: Node 22 rejects --no-webstorage.
// setup-webstorage.ts remains as a MemoryStorage fallback if the flag misses.
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
const execArgv = nodeMajor >= 25 ? ['--no-webstorage'] : []

export default defineConfig({
  test: {
    env: { TOGGLY_DISABLE_TELEMETRY: '1' },
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup-webstorage.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { execArgv },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
      },
    },
  },
})
