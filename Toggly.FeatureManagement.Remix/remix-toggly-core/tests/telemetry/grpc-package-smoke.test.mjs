import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const grpc = await import(path.join(packageDirectory, 'dist/esm/telemetry/grpc.js'))
const protoRoot = grpc.getProtoRoot()

assert.equal(
  fs.existsSync(path.join(protoRoot, 'usage.proto')),
  true,
  'The built ESM entry must resolve the packaged usage.proto file.',
)
assert.equal(
  fs.existsSync(path.join(protoRoot, 'metrics.proto')),
  true,
  'The built ESM entry must resolve the packaged metrics.proto file.',
)
