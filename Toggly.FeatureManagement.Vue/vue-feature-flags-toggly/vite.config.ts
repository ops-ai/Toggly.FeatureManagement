import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@/': new URL('./src/', import.meta.url).pathname,
    },
  },

  build: {
    cssCodeSplit: true,
    target: 'esnext',
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'VueFeatureFlagsToggly',
      fileName: (format) => `vue-feature-flags-toggly.${format}.js`,
    },

    rollupOptions: {
      external: ['vue', '@ops-ai/toggly-hooks-types', '@ops-ai/toggly-local-gates', '@ops-ai/toggly-signed-defs'],
      output: {
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
})
