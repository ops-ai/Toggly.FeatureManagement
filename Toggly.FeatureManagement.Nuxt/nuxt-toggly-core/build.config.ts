import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/index',
    {
      input: './src/browser',
      name: 'browser',
    },
    {
      input: './src/telemetry/grpc-clients',
      name: 'telemetry/grpc',
    },
  ],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
  },
  externals: ['@grpc/grpc-js', '@grpc/proto-loader'],
})
