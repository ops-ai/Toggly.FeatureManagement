import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'integration/index': 'src/integration/index.ts',
    'server/toggly-server': 'src/server/toggly-server.ts',
    'server/utils': 'src/server/utils.ts',
    'client/store': 'src/client/store.ts',
    'client/setup': 'src/client/setup.ts',
    'frameworks/react/index': 'src/frameworks/react/index.ts',
    'frameworks/react/Feature': 'src/frameworks/react/Feature.tsx',
    'frameworks/vue/composables': 'src/frameworks/vue/composables.ts',
    'frameworks/svelte/stores': 'src/frameworks/svelte/stores.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'astro',
    '@astrojs/check',
    '@ops-ai/toggly-local-gates',
    'nanostores',
    '@nanostores/react',
    '@nanostores/svelte',
    '@nanostores/vue',
    'react',
    'vue',
    'svelte',
  ],
});


