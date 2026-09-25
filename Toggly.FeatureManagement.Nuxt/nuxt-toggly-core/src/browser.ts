export type {
  TogglyConfig,
  TogglyClient,
  TogglyState,
  FeatureRequirement,
  FeatureGate,
  FeatureDefinitions,
  Hook,
  HookMetadata,
  EvaluationMode,
  EvaluatedDefinitions,
  TogglyEntityContext,
  EvalContextOverrides,
  EvalContextArg,
  VariantResult,
  EvaluatedVariantDef,
  FrontendTelemetryRuntime,
  FrontendTelemetryFactory,
} from './types'
export { HookExecutor } from './hooks'
export { normalizeFeatureKeys, evaluateGate } from './utils'
export { decodeVariantValue } from './decode-variant-value'
import { createTogglyClient as createBaseClient } from './client'
import type { TogglyConfig } from './types'
/** Browser ownership is explicit even when telemetry is opted out or during SSR. */
export const createTogglyClient = (config: TogglyConfig = {}) => createBaseClient({
  ...config, frontendTelemetryFactory: config.frontendTelemetryFactory ?? (() => null),
})
