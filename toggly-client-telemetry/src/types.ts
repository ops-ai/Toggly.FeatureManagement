/** Payload-free, bounded diagnostic codes; no application or event data. */
export type TelemetryDiagnostic = 'invalid-option' | 'invalid-event' | 'buffer-full' | 'metric-kind-conflict' | 'transport-drop' | 'compression-fallback';
export interface TelemetryReporter {
  recordCheck(featureKey: string, variant: string): void;
  recordUsage(featureKey: string, variant?: string): void;
  recordView(featureKey: string, variant?: string): void;
  incrementCounter(metricKey: string, value?: number): void;
  setGauge(metricKey: string, value: number): void;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  dispose(): void;
}
export interface TelemetryResponse { status: number; headers?: { get(name: string): string | null }; }
/** Structural platform signal; declarations do not require lib.dom. */
export interface TelemetryAbortSignal {
  readonly aborted: boolean;
  readonly reason: any;
  onabort: ((this: TelemetryAbortSignal, event: any) => any) | null;
  throwIfAborted(): void;
  addEventListener(type: string, listener: any, options?: any): void;
  removeEventListener(type: string, listener: any, options?: any): void;
  dispatchEvent(event: any): boolean;
}
export interface TelemetryRequestInit {
  method: 'POST';
  credentials: 'omit';
  headers: Record<string, string>;
  body: string | ArrayBuffer;
  keepalive: boolean;
  signal?: TelemetryAbortSignal;
}
export type TelemetryFetch = (url: string, init: TelemetryRequestInit) => Promise<TelemetryResponse>;
export interface TelemetryOptions {
  appKey?: string;
  environment?: string;
  enableTelemetry?: boolean;
  metricsBaseUrl?: string;
  telemetryFlushIntervalMs?: number;
  fetch?: TelemetryFetch;
  onDiagnostic?: (diagnostic: TelemetryDiagnostic) => void;
  /** @internal Deterministic platform seams. SDK facades must not forward these. */
  _runtime?: {
    now?: () => number;
    random?: () => number;
    gzip?: (json: string) => Promise<ArrayBuffer | undefined>;
  };
}
