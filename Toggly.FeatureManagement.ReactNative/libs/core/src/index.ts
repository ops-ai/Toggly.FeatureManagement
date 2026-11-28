// Models and types
export * from './models';

// Soft-null typed variant decode (matches JS / Vue / Next / Nuxt)
export { decodeVariantValue } from './decode-variant-value';

// Soft-null typed flag value decode (OPS-2102 / OPS-2107)
export {
  decodeDateTimeValue,
  decodeJsonValue,
  decodeNumberValue,
  decodeStringValue,
  valueTypeMatches,
} from './decode-feature-value';

// Services
export { TogglyService } from './services/TogglyService';
export { HookExecutor } from './services/HookExecutor';
export { EventEmitter } from './services/EventEmitter';
export { MemoryStorage } from './services/MemoryStorage';

// Re-export hook types for convenience
export type {
  Hook,
  HookMetadata,
  EvaluationSeriesData,
  IdentitySeriesData,
} from '@ops-ai/toggly-hooks-types';
