import type { TelemetryDiagnostic } from '@ops-ai/toggly-client-telemetry';
import type { Jwk } from '@ops-ai/toggly-signed-defs';
import type {
  EvaluatedDefinitions,
  TogglyEntityContext,
  TogglyEvaluationContext,
} from '@ops-ai/toggly-hooks-types';
import type { LocalGate } from '@ops-ai/toggly-local-gates';
export type { EvaluatedDefinitions, TogglyEntityContext, TogglyEvaluationContext, LocalGate };

/**
 * Raw evaluated entry from `/evaluated-variants-signed`.
 */
export interface EvaluatedVariantDef {
  enabled: boolean;
  variant?: string;
  configurationValue?: unknown;
}

/**
 * Assigned variant for a feature (requires {@link BrowserOptions.enableVariants} /
 * {@link ServerFrontendOptions.enableVariants} and a loaded snapshot).
 */
export interface VariantResult {
  name: string;
  configurationValue?: unknown;
}

export interface TogglySnapshot {
  definitions: EvaluatedDefinitions;
  /** Raw exposed variant entries; present only when variants are enabled. */
  variants?: Record<string, EvaluatedVariantDef>;
  /** Server-owned provenance; omitted/manual snapshots are authoritative. */
  source?: 'signed' | 'defaults';
  /** Trusted SSR verification metadata, not a portable signed credential. */
  signedTimestamp?: number;
  signingKey?: Jwk;
  /** Explicitly public targeting data. Never put secrets or authentication claims here. */
  context: TogglyEvaluationContext & { instanceId?: string };
  expose: string[];
}
export interface GateOptions {
  requirement?: 'all' | 'any';
  negate?: boolean;
  entity?: TogglyEntityContext;
  defaultValue?: boolean;
}
export interface BrowserOptions {
  /** Front-end App Key only. Backend keys belong in hooks.server.ts. */
  appKey?: string;
  environment?: string;
  /** Initial host token convenience; subsequent snapshots own rotation and clearing. */
  instanceId?: string;
  /** Browser telemetry defaults on for a configured frontend App Key. */
  enableTelemetry?: boolean;
  /** Independent metrics service base URL; no targeting context is attached. */
  metricsBaseUrl?: string;
  /** Base flush interval, 30000–60000 ms (default 45000), with jitter. */
  telemetryFlushIntervalMs?: number;
  /** Bounded payload-free diagnostics; observer errors do not affect evaluation. */
  onTelemetryDiagnostic?: (code: TelemetryDiagnostic) => void;
  baseURI?: string;
  /** Origin-owned persistence for exact signed envelopes and verified public keys. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Independent key pins, applied to network and restored signed state. */
  allowedKeyIds?: string[];
  /** Maximum signed age; unset or nonpositive keeps signatures valid without an age limit. */
  maxSignatureAgeSeconds?: number;
  /** Polling interval in milliseconds (default 180000); nonpositive disables polling. */
  refreshInterval?: number;
  /** Abort an unfinished definitions/JWKS request after this many ms (default 5000). */
  timeout?: number;
  /** WebSocket updates are enabled by default, with polling as a fallback. */
  enableLiveUpdates?: boolean;
  localGates?: LocalGate[];
  onError?: (message: string, error?: unknown) => void;
  /**
   * When true, fetch `/evaluated-variants-signed` instead of `/evaluated-signed` and
   * expose {@link VariantResult} via the store's `getVariant` / `getVariantValue`. Default false.
   */
  enableVariants?: boolean;
}
/** Copy only named fields; never serialize a service, backend config or raw server rules. */
export function selectDefinitions(
  definitions: EvaluatedDefinitions,
  expose: readonly string[],
): EvaluatedDefinitions {
  return structuredClone(
    Object.fromEntries(
      expose.filter((key) => Object.hasOwn(definitions, key)).map((key) => [key, definitions[key]]),
    ),
  );
}
/** Copy only named variant entries; keeps unexposed feature assignments out of the client snapshot. */
export function selectVariantDefs(
  variants: Record<string, EvaluatedVariantDef>,
  expose: readonly string[],
): Record<string, EvaluatedVariantDef> {
  return structuredClone(
    Object.fromEntries(
      expose.filter((key) => Object.hasOwn(variants, key)).map((key) => [key, variants[key]]),
    ),
  );
}
/** Derive boolean-per-key definitions from raw variant entries (`enabled === true`). */
export function variantDefsToFlags(
  variants: Record<string, EvaluatedVariantDef>,
): EvaluatedDefinitions {
  const out: EvaluatedDefinitions = {};
  for (const key of Object.keys(variants)) {
    out[key] = variants[key]?.enabled === true;
  }
  return out;
}
