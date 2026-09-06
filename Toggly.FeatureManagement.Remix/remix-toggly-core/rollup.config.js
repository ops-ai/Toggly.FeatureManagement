import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = [
  '@ops-ai/toggly-eval',
  '@ops-ai/toggly-hooks-types',
  '@ops-ai/toggly-local-gates',
  '@grpc/grpc-js',
  '@grpc/proto-loader',
  'node:fs',
  'node:module',
  'node:path',
  'node:url',
  'fs',
  'module',
  'path',
  'url',
  'crypto',
  'node:crypto',
];

function jsBuild(input, esmFile, cjsFile) {
  return [
    {
      input,
      output: {
        file: esmFile,
        format: 'esm',
        sourcemap: true,
      },
      plugins: [
        resolve({ preferBuiltins: true }),
        commonjs(),
        typescript({
          tsconfig: './tsconfig.json',
          declaration: false,
          outDir: 'dist/esm',
        }),
      ],
      external,
    },
    {
      input,
      output: {
        file: cjsFile,
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
      plugins: [
        resolve({ preferBuiltins: true }),
        commonjs(),
        typescript({
          tsconfig: './tsconfig.json',
          declaration: false,
          outDir: 'dist/cjs',
        }),
      ],
      external,
    },
  ];
}

const config = [
  ...jsBuild('src/index.ts', 'dist/esm/index.js', 'dist/cjs/index.js'),
  ...jsBuild(
    'src/telemetry/grpc-clients.ts',
    'dist/esm/telemetry/grpc.js',
    'dist/cjs/telemetry/grpc.js',
  ),
  // Type declarations — main entry
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
  // Type declarations — gRPC subpath
  {
    input: 'src/telemetry/grpc-clients.ts',
    output: {
      file: 'dist/telemetry/grpc.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
];

export default config;
