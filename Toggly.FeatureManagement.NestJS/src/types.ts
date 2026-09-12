import type { FactoryProvider, ModuleMetadata, Provider } from '@nestjs/common'
import type { EvaluationContext, TogglyServerConfig, TogglyEntityContext } from '@ops-ai/toggly-node-core'
export const TOGGLY_OPTIONS = Symbol('TOGGLY_OPTIONS')
export interface TogglyModuleOptions<Request = unknown> extends TogglyServerConfig {
  /** Resolve trusted application context at first evaluation, after authentication. */
  contextFactory?: (request: Request) => EvaluationContext | Promise<EvaluationContext>
  /** Export providers globally. Register one root module per application. */
  isGlobal?: boolean
}
export interface TogglyModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  isGlobal?: boolean
  providers?: Provider[]
  inject?: FactoryProvider['inject']
  useFactory: (...dependencies: any[]) => TogglyModuleOptions<any> | Promise<TogglyModuleOptions<any>>
}
export interface EvaluationOverrides {
  context?: EvaluationContext
  entity?: TogglyEntityContext | Record<string, unknown> | null
  kind?: string
}
export interface FeatureFlagOptions {
  requirement?: 'all' | 'any'
  negate?: boolean
  disabledStatus?: 403 | 404
}
