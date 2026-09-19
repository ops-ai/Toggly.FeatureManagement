/** Payload-free, bounded diagnostic codes; no application or event data. */
export type TelemetryDiagnostic = 'invalid-option' | 'invalid-event' | 'buffer-full' | 'metric-kind-conflict' | 'transport-drop' | 'compression-fallback';
export interface TelemetryReporter {
  recordCheck(featureKey: string, variant: string): void;
  /** @internal Capture this owner's check attribution before invoking host callbacks. */
  captureCheck(): (featureKey: string, variant: string) => void;
  recordUsage(featureKey: string, variant?: string): void;
  recordView(featureKey: string, variant?: string): void;
  incrementCounter(metricKey: string, value?: number): void;
  setGauge(metricKey: string, value: number): void;
  /** Atomically replace attribution; omitted routing fields retain their current values. */
  setContext(context: TelemetryContext): void;
  flush(options?: { keepalive?: boolean }): Promise<void>;
  /** Stop synchronously; flush at most one final envelope unless flush is false. */
  dispose(options?: { flush?: boolean }): void;
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
export interface TelemetryContext {
  /** Omitted preserves the current key; blank disables new event admission. */
  appKey?: string;
  /** Omitted preserves the current environment. */
  environment?: string;
  /** Omitted or blank clears minted attribution. Nonblank takes precedence over identity. */
  instanceId?: string;
  /** Omitted or blank clears client attribution. */
  identity?: string;
}
export interface TelemetryOptions extends TelemetryContext {
  enableTelemetry?: boolean;
  metricsBaseUrl?: string;
  telemetryFlushIntervalMs?: number;
  /** Opaque minted instance id; sent as compact body field `i`. */
  instanceId?: string;
  /** Client-asserted identity; sent as compact body field `u` when `instanceId` is absent. */
  identity?: string;
  fetch?: TelemetryFetch;
  onDiagnostic?: (diagnostic: TelemetryDiagnostic) => void;
  /** @internal Deterministic platform seams. SDK facades must not forward these. */
  _runtime?: {
    now?: () => number;
    random?: () => number;
    gzip?: (json: string) => Promise<ArrayBuffer | undefined>;
  };
}
