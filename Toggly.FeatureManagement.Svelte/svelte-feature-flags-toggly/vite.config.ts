import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

const signedDefsSrc = resolve(__dirname, '../../toggly-signed-defs/src/index.ts')

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        customElement: false
      }
    })
  ],
  resolve: {
    conditions: ['browser'],
    alias: {
      '@ops-ai/toggly-signed-defs': signedDefsSrc,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, '**/smoke*.test.ts', '**/smoke*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.svelte', '../../toggly-signed-defs/src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/__tests__/**',
        'src/**/index.ts',
        'src/**/*.types.ts',
        'src/utils/createToggly.ts',
        '../../toggly-signed-defs/src/**/*.test.ts',
      ],
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
      external: [
        'svelte',
        'svelte/store',
        '@ops-ai/toggly-hooks-types',
        '@ops-ai/toggly-local-gates',
        '@ops-ai/toggly-signed-defs',
      ],
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
