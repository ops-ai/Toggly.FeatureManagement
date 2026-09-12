import {
  createParamDecorator,
  Inject,
  Injectable,
  Scope,
  SetMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { TogglyService } from './service.js';
import type { FeatureFlagOptions } from './types.js';
export const FEATURE_FLAG_METADATA = Symbol('TOGGLY_FEATURE_FLAG');
export interface FeatureFlagMetadata extends FeatureFlagOptions {
  keys: string[];
}
/** Apply alongside UseGuards(FeatureFlagGuard); method metadata overrides controller metadata. */
export function FeatureFlag(keys: string | string[], options: FeatureFlagOptions = {}) {
  const normalized = typeof keys === 'string' ? [keys] : [...keys];
  if (!normalized.length || normalized.some((key) => !key.trim()))
    throw new Error('FeatureFlag requires non-empty feature keys');
  return SetMetadata(FEATURE_FLAG_METADATA, {
    keys: normalized,
    ...options,
  } satisfies FeatureFlagMetadata);
}
/** Resolve parameter gates with the enclosing HTTP request context. */
@Injectable({ scope: Scope.REQUEST })
export class FeatureEnabledPipe implements PipeTransform<string, Promise<boolean>> {
  constructor(@Inject(TogglyService) private readonly toggly: TogglyService) {}

  transform(key: string): Promise<boolean> {
    return this.toggly.isFeatureOn(key);
  }
}
const featureKeyParameter = createParamDecorator((key: string) => key);

/** Inject an asynchronously evaluated boolean into an HTTP handler parameter. */
export function FeatureEnabled(key: string): ParameterDecorator {
  return featureKeyParameter(key, FeatureEnabledPipe);
}
