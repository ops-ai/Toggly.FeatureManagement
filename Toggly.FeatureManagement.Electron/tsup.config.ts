import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/main/index.ts',
    'src/preload/index.ts',
    'src/renderer/index.ts',
    'src/react/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  minify: false,
  target: 'node18',
  outDir: 'dist',
  external: ['electron', 'react', 'react/jsx-runtime', 'ws'],
})
