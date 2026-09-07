import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SDK_ID = 'remix';
const SDK_VERSION = '1.7.0';
function sdkUserAgent() {
    return `toggly-${SDK_ID}/${SDK_VERSION}`;
}

new TextEncoder();

const DEFAULT_METRICS_BASE_URL = 'https://app.toggly.io/';

/**
 * Resolve this module's URL without a static `import.meta` reference so Jest's
 * CJS transform can load the file. Bundled ESM still gets the real module URL
 * via eval; Jest/CJS falls back to `__filename`.
 */
function resolveThisModuleUrl() {
    try {
        // eslint-disable-next-line no-eval -- avoid static import.meta for Jest CJS
        return eval('import.meta.url');
    }
    catch {
        return pathToFileURL(__filename).href;
    }
}
const thisModuleUrl = resolveThisModuleUrl();
const nodeRequire = createRequire(thisModuleUrl);
/**
 * Resolve vendored proto/ for source (src/telemetry), bundled dist/ ESM+CJS,
 * and the published package layout (files includes "proto").
 */
function resolveProtoRoot(moduleUrl = thisModuleUrl) {
    const moduleDir = path.dirname(fileURLToPath(moduleUrl));
    const candidates = [
        // Built dist/telemetry/grpc.js → packageRoot/proto
        path.resolve(moduleDir, '..', '..', 'proto'),
        // Built dist/index.js sibling layouts
        path.resolve(moduleDir, '..', 'proto'),
        // Source src/telemetry/*.ts → packageRoot/proto
        path.resolve(moduleDir, '..', '..', 'proto'),
        path.resolve(moduleDir, 'proto'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'usage.proto'))) {
            return candidate;
        }
    }
    return candidates[0] ?? path.resolve(moduleDir, '..', '..', 'proto');
}
const protoRoot = resolveProtoRoot();
function grpcTarget(baseUrl) {
    try {
        const u = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
        let host = u.host;
        if (!host.includes(':')) {
            host = `${host}:443`;
        }
        return host;
    }
    catch {
        const trimmed = baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return trimmed.includes(':') ? trimmed : `${trimmed}:443`;
    }
}
function resolveUserAgent(override) {
    return override ?? sdkUserAgent();
}
function tryLoadGrpcModules() {
    try {
        // Optional peer/optionalDependencies — evaluate flags without gRPC installed.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const grpc = nodeRequire('@grpc/grpc-js');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const protoLoader = nodeRequire('@grpc/proto-loader');
        return { grpc, protoLoader };
    }
    catch {
        return null;
    }
}
function loadPackageDefinition(protoLoader, grpc, protoFile) {
    const packageDefinition = protoLoader.loadSync(path.join(protoRoot, protoFile), {
        keepCase: true,
        longs: Number,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [protoRoot],
    });
    return grpc.loadPackageDefinition(packageDefinition);
}
function createMetadata(grpc, map) {
    const metadata = new grpc.Metadata();
    if (map) {
        for (const [key, value] of Object.entries(map)) {
            metadata.set(key, value);
        }
    }
    return metadata;
}
/**
 * Dial usage + metrics gRPC clients against metricsBaseUrl.
 * Returns null when @grpc/grpc-js (+ proto-loader) are not installed.
 */
function createGrpcClients(metricsBaseUrl = DEFAULT_METRICS_BASE_URL, userAgent) {
    const modules = tryLoadGrpcModules();
    if (!modules) {
        return null;
    }
    const { grpc, protoLoader } = modules;
    const target = grpcTarget(metricsBaseUrl);
    const credentials = grpc.credentials.createSsl();
    const ua = resolveUserAgent(userAgent);
    const defaultMeta = { UA: ua };
    const usageDef = loadPackageDefinition(protoLoader, grpc, 'usage.proto');
    const metricsDef = loadPackageDefinition(protoLoader, grpc, 'metrics.proto');
    const UsageService = usageDef.Usage
        .Usage;
    const MetricsService = metricsDef.Metrics.Metrics;
    const usageStub = new UsageService(target, credentials);
    const metricsStub = new MetricsService(target, credentials);
    return {
        usage: {
            sendStats(request, metadata) {
                return new Promise((resolve, reject) => {
                    usageStub.SendStats(request, createMetadata(grpc, { ...defaultMeta, ...metadata }), (err, res) => {
                        if (err)
                            reject(err);
                        else
                            resolve(res ?? {});
                    });
                });
            },
            close() {
                usageStub.close();
            },
        },
        metrics: {
            sendMetrics(request, metadata) {
                return new Promise((resolve, reject) => {
                    metricsStub.SendMetrics(request, createMetadata(grpc, { ...defaultMeta, ...metadata }), (err, res) => {
                        if (err)
                            reject(err);
                        else
                            resolve(res ?? {});
                    });
                });
            },
            close() {
                metricsStub.close();
            },
        },
    };
}
function isGrpcAvailable() {
    return tryLoadGrpcModules() !== null;
}
function getProtoRoot() {
    return protoRoot;
}

export { DEFAULT_METRICS_BASE_URL, createGrpcClients, getProtoRoot, grpcTarget, isGrpcAvailable, resolveProtoRoot, resolveUserAgent };
//# sourceMappingURL=grpc.js.map
