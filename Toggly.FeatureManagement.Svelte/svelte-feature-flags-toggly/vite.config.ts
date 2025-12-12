import { defineConfig } from 'vite'
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
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SvelteFeatureFlagsToggly',
      formats: ['es', 'cjs'],
      fileName: (format) => `svelte-feature-flags-toggly.${format === 'es' ? 'es' : 'cjs'}`
    },
    rollupOptions: {
      external: ['svelte', 'svelte/store'],
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
