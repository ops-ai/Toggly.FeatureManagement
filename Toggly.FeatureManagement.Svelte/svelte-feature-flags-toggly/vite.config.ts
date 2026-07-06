import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        customElement: false
      }
    })
  ],
  resolve: {
    conditions: ['browser']
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '**/smoke*.test.ts', '**/smoke*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.svelte'],
      exclude: ['src/**/*.spec.ts', 'src/__tests__/**', 'src/**/index.ts', 'src/**/*.types.ts', 'src/utils/createToggly.ts'],
      thresholds: {
        statements: 90,
        branches: 84,
        functions: 90,
        lines: 90
      }
    }
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SvelteFeatureFlagsToggly',
      formats: ['es', 'cjs'],
      fileName: (format) => `svelte-feature-flags-toggly.${format === 'es' ? 'es' : 'cjs'}`
    },
    rollupOptions: {
      external: ['svelte', 'svelte/store', '@ops-ai/toggly-hooks-types', '@ops-ai/toggly-local-gates'],
      output: {
        globals: {
          svelte: 'Svelte',
          'svelte/store': 'SvelteStore'
        },
        // Preserve module structure for Svelte components
        preserveModules: false
      }
    }
  }
})
