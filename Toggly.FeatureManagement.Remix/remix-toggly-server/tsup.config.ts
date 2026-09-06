import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  external: [
    '@ops-ai/remix-toggly-core',
    '@ops-ai/remix-toggly-core/telemetry/grpc',
    '@grpc/grpc-js',
    '@grpc/proto-loader',
    '@remix-run/node',
    '@remix-run/server-runtime',
  ],
})
