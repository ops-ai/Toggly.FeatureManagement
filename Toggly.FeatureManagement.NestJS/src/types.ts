import type { FactoryProvider, ModuleMetadata, Provider } from '@nestjs/common';
import type {
  EvaluationContext,
  TogglyServerConfig,
  TogglyEntityContext,
} from '@ops-ai/toggly-node-core';
export const TOGGLY_OPTIONS = Symbol('TOGGLY_OPTIONS');

/** Backend core configuration plus Nest dependency injection and request context hooks. */
export interface TogglyModuleOptions<Request = unknown> extends TogglyServerConfig {
  /** Resolve trusted application context at first evaluation, after authentication. */
  contextFactory?: (request: Request) => EvaluationContext | Promise<EvaluationContext>;
  /** Export providers globally. Register one root module per application. */
  isGlobal?: boolean;
}
/** Resolve one application configuration through Nest providers at bootstrap. */
export interface TogglyModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  isGlobal?: boolean;
  /** Additional providers available to the configuration factory. */
  providers?: Provider[];
  inject?: FactoryProvider['inject'];
  useFactory: (
    ...dependencies: any[]
  ) => TogglyModuleOptions<any> | Promise<TogglyModuleOptions<any>>;
}
/** Per-call context and entity overrides; never mutate the shared core identity. */
export interface EvaluationOverrides {
  context?: EvaluationContext;
  entity?: TogglyEntityContext | Record<string, unknown> | null;
  kind?: string;
}
/** HTTP rollout gate behavior; authentication and authorization remain application-owned. */
export interface FeatureFlagOptions {
  requirement?: 'all' | 'any';
  negate?: boolean;
  disabledStatus?: 403 | 404;
}
