// import { defineConfig } from 'vite'
// import vue from '@vitejs/plugin-vue'

// // https://vitejs.dev/config/
// export default defineConfig({
//   plugins: [vue()],
// })

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

const signedDefsSrc = path.resolve(__dirname, '../../toggly-signed-defs/src/index.ts')

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@/': new URL('./src/', import.meta.url).pathname,
      '@ops-ai/toggly-signed-defs': signedDefsSrc,
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
