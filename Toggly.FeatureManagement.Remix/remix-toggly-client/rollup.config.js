import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = [
  '@ops-ai/remix-toggly-core',
  '@remix-run/react',
  'react',
  'react-dom',
  'react/jsx-runtime',
];

const config = [
  // ESM build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/esm/index.js',
      format: 'esm',
      sourcemap: true,
    },
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        outDir: 'dist/esm',
      }),
    ],
    external,
  },
  // CJS build
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/cjs/index.js',
      format: 'cjs',
      sourcemap: true,
    },
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        outDir: 'dist/cjs',
      }),
    ],
    external,
  },
  // Type declarations
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
    external,
  },
];

export default config;
