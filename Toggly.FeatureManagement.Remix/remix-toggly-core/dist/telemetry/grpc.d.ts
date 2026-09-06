declare const DEFAULT_METRICS_BASE_URL = "https://app.toggly.io/";

/**
 * Resolve vendored proto/ for source (src/telemetry), bundled dist/ ESM+CJS,
 * and the published package layout (files includes "proto").
 */
declare function resolveProtoRoot(moduleUrl?: string): string;
declare function grpcTarget(baseUrl: string): string;
declare function resolveUserAgent(override?: string): string;
type GrpcMetadataMap = Record<string, string>;
interface UsageGrpcClient {
    sendStats(request: Record<string, unknown>, metadata?: GrpcMetadataMap): Promise<{
        featureCount?: number;
    }>;
    close(): void;
}
interface MetricsGrpcClient {
    sendMetrics(request: Record<string, unknown>, metadata?: GrpcMetadataMap): Promise<{
        count?: number;
    }>;
    close(): void;
}
interface GrpcClients {
    usage: UsageGrpcClient;
    metrics: MetricsGrpcClient;
}
/**
 * Dial usage + metrics gRPC clients against metricsBaseUrl.
 * Returns null when @grpc/grpc-js (+ proto-loader) are not installed.
 */
declare function createGrpcClients(metricsBaseUrl?: string, userAgent?: string): GrpcClients | null;
declare function isGrpcAvailable(): boolean;
declare function getProtoRoot(): string;

export { DEFAULT_METRICS_BASE_URL, createGrpcClients, getProtoRoot, grpcTarget, isGrpcAvailable, resolveProtoRoot, resolveUserAgent };
export type { GrpcClients, GrpcMetadataMap, MetricsGrpcClient, UsageGrpcClient };
