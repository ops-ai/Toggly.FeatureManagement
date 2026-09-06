import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sdkUserAgent } from '../sdk-identity.js'
import { DEFAULT_METRICS_BASE_URL } from './https-client.js'

const require = createRequire(import.meta.url)

/**
 * Resolve vendored proto/ for source (src/telemetry), bundled dist/ ESM+CJS,
 * and the published package layout (files includes "proto").
 */
export function resolveProtoRoot(moduleUrl: string = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl))
  const candidates = [
    // Built dist/telemetry/grpc.js → packageRoot/proto
    path.resolve(moduleDir, '..', '..', 'proto'),
    // Built dist/index.js sibling layouts
    path.resolve(moduleDir, '..', 'proto'),
    // Source src/telemetry/*.ts → packageRoot/proto
    path.resolve(moduleDir, '..', '..', 'proto'),
    path.resolve(moduleDir, 'proto'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'usage.proto'))) {
      return candidate
    }
  }
  return candidates[0] ?? path.resolve(moduleDir, '..', '..', 'proto')
}

const protoRoot = resolveProtoRoot()

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
  metricsBaseUrl: string = DEFAULT_METRICS_BASE_URL,
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

export { DEFAULT_METRICS_BASE_URL }
