import { describe, it, expect } from 'vitest'
import {
  grpcTarget,
  getProtoRoot,
  isGrpcAvailable,
  createGrpcClients,
} from '../../src/telemetry/grpc-clients'
import fs from 'node:fs'
import path from 'node:path'

describe('grpc-clients helpers', () => {
  it('parses metrics base URL into host:port', () => {
    expect(grpcTarget('https://app.toggly.io/')).toBe('app.toggly.io:443')
    expect(grpcTarget('https://localhost:5001')).toBe('localhost:5001')
    expect(grpcTarget('app.toggly.io')).toBe('app.toggly.io:443')
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

  it('loads package definitions when optional gRPC deps are present', () => {
    if (!isGrpcAvailable()) {
      expect(createGrpcClients('https://app.toggly.io/')).toBeNull()
      return
    }
    const clients = createGrpcClients('https://app.toggly.io/')
    expect(clients).not.toBeNull()
    clients!.usage.close()
    clients!.metrics.close()
  })
})
