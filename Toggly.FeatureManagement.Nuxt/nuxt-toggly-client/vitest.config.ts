import { defineConfig } from 'vitest/config'

// Node 25+ ships a built-in localStorage accessor that shadows happy-dom's
// Storage unless Web Storage is disabled for the worker. Vitest 3/4 do not
// copy Storage onto the worker global in that case, so localStorage.clear()
// throws. Gate the flag: Node 22 rejects --no-webstorage as an unknown option.
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)

export default defineConfig({
  test: {
    env: { TOGGLY_DISABLE_TELEMETRY: '1' },
    globals: true,
    environment: 'happy-dom',
    execArgv: nodeMajor >= 25 ? ['--no-webstorage'] : [],
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
