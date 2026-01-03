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
    'frameworks/vue/index': 'src/frameworks/vue/index.ts',
    'frameworks/svelte/index': 'src/frameworks/svelte/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    'astro',
    '@astrojs/check',
    'nanostores',
    '@nanostores/react',
    '@nanostores/vue',
    'react',
    'vue',
    'svelte',
    '@ops-ai/toggly-client-core',
  ],
});


