import { describe, it, expect } from 'vitest'
import {
  grpcTarget,
  getProtoRoot,
  isGrpcAvailable,
  createGrpcClients,
  resolveProtoRoot,
  resolveUserAgent,
} from '../../src/telemetry/grpc-clients'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

describe('grpc-clients helpers', () => {
  it('parses metrics base URL into host:port', () => {
    expect(grpcTarget('https://app.toggly.io/')).toBe('app.toggly.io:443')
    expect(grpcTarget('https://localhost:5001')).toBe('localhost:5001')
    expect(grpcTarget('app.toggly.io')).toBe('app.toggly.io:443')
    expect(grpcTarget('not a url :')).toMatch(/:/)
  })

  it('resolveUserAgent uses override or sdk default', () => {
    expect(resolveUserAgent('custom-ua')).toBe('custom-ua')
    expect(resolveUserAgent()).toMatch(/^toggly-nuxt\//)
  })

  it('vendors usage and metrics protos with expected services', () => {
    const root = getProtoRoot()
    const usage = fs.readFileSync(path.join(root, 'usage.proto'), 'utf8')
    const metrics = fs.readFileSync(path.join(root, 'metrics.proto'), 'utf8')
    expect(usage).toContain('rpc SendStats')
    expect(usage).toContain('variantStats')
    expect(metrics).toContain('rpc SendMetrics')
    expect(metrics).toContain('variantValues')
  })

  it('resolveProtoRoot finds proto for source and dist-like layouts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-proto-'))
    try {
      const packageProto = path.join(tmp, 'proto')
      fs.mkdirSync(packageProto, { recursive: true })
      fs.writeFileSync(path.join(packageProto, 'usage.proto'), 'syntax = "proto3";')

      const distDir = path.join(tmp, 'dist')
      fs.mkdirSync(distDir)
      const distModule = pathToFileURL(path.join(distDir, 'index.js')).href
      expect(resolveProtoRoot(distModule)).toBe(path.resolve(packageProto))

      const nestedDistDir = path.join(tmp, 'dist', 'cjs', 'telemetry')
      fs.mkdirSync(nestedDistDir, { recursive: true })
      const nestedDistModule = pathToFileURL(path.join(nestedDistDir, 'grpc.js')).href
      expect(resolveProtoRoot(nestedDistModule)).toBe(path.resolve(packageProto))

      const telemetryDir = path.join(tmp, 'src', 'telemetry')
      fs.mkdirSync(telemetryDir, { recursive: true })
      const sourceModule = pathToFileURL(path.join(telemetryDir, 'grpc-clients.js')).href
      expect(resolveProtoRoot(sourceModule)).toBe(path.resolve(packageProto))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('loads package definitions when optional gRPC deps are present', async () => {
    if (!isGrpcAvailable()) {
      expect(createGrpcClients('https://app.toggly.io/')).toBeNull()
      return
    }
    const clients = createGrpcClients('https://app.toggly.io/', 'ua-test')
    expect(clients).not.toBeNull()
    // Soft network call exercises send wrappers (expect reject without a live server).
    await expect(
      clients!.usage.sendStats({
        appKey: 'app',
        environment: 'Production',
        time: { seconds: 0, nanos: 0 },
        stats: [],
        totalUniqueUsers: 0,
        uniqueUserHashes: [],
      }),
    ).rejects.toBeTruthy()
    await expect(
      clients!.metrics.sendMetrics({
        appKey: 'app',
        environment: 'Production',
        time: { seconds: 0, nanos: 0 },
        stats: [],
        counters: [],
        observations: [],
      }),
    ).rejects.toBeTruthy()
    clients!.usage.close()
    clients!.metrics.close()
  })
})
