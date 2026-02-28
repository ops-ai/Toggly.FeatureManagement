import { defineConfig } from 'vitest/config'

// Smoke test config — does NOT exclude smoke test files
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
