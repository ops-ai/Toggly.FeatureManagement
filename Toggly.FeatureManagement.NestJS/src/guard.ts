import { Inject, Injectable, NotFoundException, ForbiddenException, ServiceUnavailableException, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { FEATURE_FLAG_METADATA, type FeatureFlagMetadata } from './decorators.js'
import { TogglyService } from './service.js'
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(TogglyService) private readonly toggly: TogglyService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<FeatureFlagMetadata>(FEATURE_FLAG_METADATA, [context.getHandler(), context.getClass()])
    if (!flag) return true
    if (context.getType() !== 'http') throw new ServiceUnavailableException('FeatureFlagGuard supports HTTP contexts only')
    let allowed: boolean
    try { allowed = await this.toggly.evaluateFeatureGate(flag.keys, flag.requirement, flag.negate) }
    catch { throw new ServiceUnavailableException('Feature evaluation unavailable') }
    if (!allowed) {
      if (flag.disabledStatus === 403) throw new ForbiddenException('Feature disabled')
      throw new NotFoundException('Feature disabled')
    }
    return true
  }
}
