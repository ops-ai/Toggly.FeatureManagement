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

function replaceModuleUrl(replacement) {
  return {
    name: 'replace-toggly-module-url',
    transform(code, id) {
      if (!id.endsWith('/telemetry/grpc-clients.ts')) return null;
      return {
        code: code.replace('globalThis.__TOGGLY_MODULE_URL__', replacement),
        map: null,
      };
    },
  };
}

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
        replaceModuleUrl('import.meta.url'),
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
        replaceModuleUrl("require('node:url').pathToFileURL(__filename).href"),
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
