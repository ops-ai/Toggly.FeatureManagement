import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sdkUserAgent } from '../sdk-identity.js'

const utf8Encoder = new TextEncoder()

const require = createRequire(import.meta.url)

/**
 * Resolve vendored proto/ for source (src/telemetry), bundled dist/ ESM+CJS,
 * and the published package layout (files includes "proto").
 */
export function resolveProtoRoot(moduleUrl: string = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl))
  const candidates = [
    // Built dist/cjs|esm/telemetry/grpc.js → packageRoot/proto
    path.resolve(moduleDir, '..', '..', '..', 'proto'),
    // Built dist/index.js|cjs → packageRoot/proto
    path.resolve(moduleDir, '..', 'proto'),
    // Source src/telemetry/*.ts → packageRoot/proto
    path.resolve(moduleDir, '..', '..', 'proto'),
    // Proto colocated next to the module (edge layouts)
    path.resolve(moduleDir, 'proto'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'usage.proto'))) {
      return candidate
    }
  }
  return candidates[0]
}

const protoRoot = resolveProtoRoot()

export const DEFAULT_METRICS_BASE_URL = 'https://app.toggly.io/'
export const DEFAULT_TELEMETRY_FLUSH_MS = 60_000

/**
 * FNV-1a 32-bit as signed int32 (matches Go `hash/fnv` New32a on `[]byte(s)`).
 * Hashes UTF-8 bytes — not UTF-16 code units from `String.charCodeAt`.
 */
export function hashIdentity(identity: string): number {
  let hash = 2166136261 // FNV offset basis
  const bytes = utf8Encoder.encode(identity)
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!
    hash = Math.imul(hash, 16777619) // FNV prime
  }
  const unsigned = hash >>> 0
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned
}

export function toProtobufTimestamp(date: Date = new Date()): { seconds: number; nanos: number } {
  const ms = date.getTime()
  const seconds = Math.floor(ms / 1000)
  const nanos = (ms % 1000) * 1_000_000
  return { seconds, nanos }
}

export function grpcTarget(baseUrl: string): string {
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`)
    let host = u.host
    if (!host.includes(':')) {
      host = `${host}:443`
    }
    return host
  } catch {
    const trimmed = baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    return trimmed.includes(':') ? trimmed : `${trimmed}:443`
  }
}

export function resolveUserAgent(override?: string): string {
  return override ?? sdkUserAgent()
}

export type GrpcMetadataMap = Record<string, string>

export interface UsageGrpcClient {
  sendStats(
    request: Record<string, unknown>,
    metadata?: GrpcMetadataMap,
  ): Promise<{ featureCount?: number }>
  close(): void
}

export interface MetricsGrpcClient {
  sendMetrics(
    request: Record<string, unknown>,
    metadata?: GrpcMetadataMap,
  ): Promise<{ count?: number }>
  close(): void
}

export interface GrpcClients {
  usage: UsageGrpcClient
  metrics: MetricsGrpcClient
}

type ProtoLoader = typeof import('@grpc/proto-loader')
type GrpcJs = typeof import('@grpc/grpc-js')

function tryLoadGrpcModules(): { grpc: GrpcJs; protoLoader: ProtoLoader } | null {
  try {
    // Optional peer/optionalDependencies — evaluate flags without gRPC installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const grpc = require('@grpc/grpc-js') as GrpcJs
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const protoLoader = require('@grpc/proto-loader') as ProtoLoader
    return { grpc, protoLoader }
  } catch {
    return null
  }
}

function loadPackageDefinition(
  protoLoader: ProtoLoader,
  grpc: GrpcJs,
  protoFile: string,
): Record<string, unknown> {
  const packageDefinition = protoLoader.loadSync(path.join(protoRoot, protoFile), {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [protoRoot],
  })
  return grpc.loadPackageDefinition(packageDefinition) as Record<string, unknown>
}

function createMetadata(grpc: GrpcJs, map?: GrpcMetadataMap): InstanceType<GrpcJs['Metadata']> {
  const metadata = new grpc.Metadata()
  if (map) {
    for (const [key, value] of Object.entries(map)) {
      metadata.set(key, value)
    }
  }
  return metadata
}

/**
 * Dial usage + metrics gRPC clients against metricsBaseUrl.
 * Returns null when @grpc/grpc-js (+ proto-loader) are not installed.
 */
export function createGrpcClients(
  metricsBaseUrl: string,
  userAgent?: string,
): GrpcClients | null {
  const modules = tryLoadGrpcModules()
  if (!modules) {
    return null
  }

  const { grpc, protoLoader } = modules
  const target = grpcTarget(metricsBaseUrl)
  const credentials = grpc.credentials.createSsl()
  const ua = resolveUserAgent(userAgent)
  const defaultMeta: GrpcMetadataMap = { UA: ua }

  const usageDef = loadPackageDefinition(protoLoader, grpc, 'usage.proto')
  const metricsDef = loadPackageDefinition(protoLoader, grpc, 'metrics.proto')

  const UsageService = (usageDef as { Usage: { Usage: new (...args: unknown[]) => unknown } }).Usage
    .Usage as new (
    address: string,
    creds: unknown,
  ) => {
    SendStats: (
      req: unknown,
      meta: unknown,
      cb: (err: Error | null, res: { featureCount?: number }) => void,
    ) => void
    close: () => void
  }

  const MetricsService = (
    metricsDef as { Metrics: { Metrics: new (...args: unknown[]) => unknown } }
  ).Metrics.Metrics as new (
    address: string,
    creds: unknown,
  ) => {
    SendMetrics: (
      req: unknown,
      meta: unknown,
      cb: (err: Error | null, res: { count?: number }) => void,
    ) => void
    close: () => void
  }

  const usageStub = new UsageService(target, credentials)
  const metricsStub = new MetricsService(target, credentials)

  return {
    usage: {
      sendStats(request, metadata) {
        return new Promise((resolve, reject) => {
          usageStub.SendStats(
            request,
            createMetadata(grpc, { ...defaultMeta, ...metadata }),
            (err, res) => {
              if (err) reject(err)
              else resolve(res ?? {})
            },
          )
        })
      },
      close() {
        usageStub.close()
      },
    },
    metrics: {
      sendMetrics(request, metadata) {
        return new Promise((resolve, reject) => {
          metricsStub.SendMetrics(
            request,
            createMetadata(grpc, { ...defaultMeta, ...metadata }),
            (err, res) => {
              if (err) reject(err)
              else resolve(res ?? {})
            },
          )
        })
      },
      close() {
        metricsStub.close()
      },
    },
  }
}

export function isGrpcAvailable(): boolean {
  return tryLoadGrpcModules() !== null
}

export function getProtoRoot(): string {
  return protoRoot
}
