import { defineConfig } from 'tsup'

const shared = {
  format: ['esm', 'cjs'] as const,
  dts: true,
  sourcemap: true,
  clean: false,
  target: 'es2020',
  splitting: false,
  treeshake: true,
  esbuildOptions(options: { define?: Record<string, string> }) {
    // Published ESM must resolve vendored proto/ via import.meta.url.
    options.define = {
      ...(options.define ?? {}),
      'globalThis.__TOGGLY_MODULE_URL__': 'import.meta.url',
    }
  },
}

export default defineConfig([
  {
    ...shared,
    clean: true,
    entry: { client: 'src/client/index.ts' },
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react-router',
      '@ops-ai/toggly-eval',
      '@ops-ai/toggly-hooks-types',
      '@ops-ai/toggly-local-gates',
      '@ops-ai/toggly-signed-defs',
      // Keep Node-only deps out of the client graph even if accidentally imported.
      'ws',
      '@grpc/grpc-js',
      '@grpc/proto-loader',
    ],
  },
  {
    ...shared,
    entry: {
      server: 'src/server/index.ts',
      'telemetry/grpc': 'src/core/telemetry/grpc.ts',
    },
    external: [
      'react',
      'react-dom',
      'react-router',
      '@react-router/node',
      '@ops-ai/toggly-eval',
      '@ops-ai/toggly-hooks-types',
      '@ops-ai/toggly-local-gates',
      '@ops-ai/toggly-signed-defs',
      'ws',
      '@grpc/grpc-js',
      '@grpc/proto-loader',
    ],
  },
])
