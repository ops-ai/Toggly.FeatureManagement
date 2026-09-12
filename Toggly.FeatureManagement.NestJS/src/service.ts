import { Inject, Injectable, Scope } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import type { EvaluationContext, FeatureRequirement } from '@ops-ai/toggly-node-core'
import { TogglyProvider } from './provider.js'
import { TOGGLY_OPTIONS, type EvaluationOverrides, type TogglyModuleOptions } from './types.js'
/** REQUEST scope caches context once without sharing mutable identity across users. */
@Injectable({ scope: Scope.REQUEST })
export class TogglyService {
  private resolved?: Promise<EvaluationContext>
  constructor(
    @Inject(TogglyProvider) private readonly provider: TogglyProvider,
    @Inject(TOGGLY_OPTIONS) private readonly options: TogglyModuleOptions,
    @Inject(REQUEST) private readonly request: unknown,
  ) {}
  async context(): Promise<EvaluationContext> {
    this.resolved ??= Promise.resolve().then(async () => {
      const value = await this.options.contextFactory?.(this.request)
      // An explicit anonymous identity prevents fallback to the process identity.
      return structuredClone({ ...value, identity: value?.identity ?? 'anonymous' })
    })
    return structuredClone(await this.resolved)
  }
  private async evaluationContext(overrides: EvaluationOverrides): Promise<EvaluationContext> {
    return { ...await this.context(), ...structuredClone(overrides.context) }
  }
  async isFeatureOn(key: string, overrides: EvaluationOverrides = {}): Promise<boolean> {
    return this.provider.client.isFeatureOn(key, await this.evaluationContext(overrides), overrides.entity, overrides.kind)
  }
  async isFeatureOff(key: string, overrides: EvaluationOverrides = {}): Promise<boolean> {
    return !(await this.isFeatureOn(key, overrides))
  }
  async evaluateFeatureGate(keys: string[], requirement: FeatureRequirement = 'all', negate = false, overrides: EvaluationOverrides = {}): Promise<boolean> {
    return this.provider.client.evaluateFeatureGate(keys, requirement, negate, await this.evaluationContext(overrides), overrides.entity, overrides.kind)
  }
  async recordUsage(key: string, variant?: string): Promise<void> { this.provider.client.recordUsage(key, (await this.context()).identity, variant) }
  async recordView(key: string, variant?: string): Promise<void> { this.provider.client.recordView(key, (await this.context()).identity, variant) }
}
