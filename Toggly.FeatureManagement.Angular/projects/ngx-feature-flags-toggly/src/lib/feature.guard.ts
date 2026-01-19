import {
  CanActivateFn,
  ActivatedRouteSnapshot,
  Router,
  CanActivate,
} from '@angular/router'
import { TogglyService } from './toggly.service'
import { inject, Injectable } from '@angular/core'

/**
 * Functional route guard for feature flags (Angular 15+)
 *
 * Usage in routes:
 * ```typescript
 * {
 *   path: 'premium',
 *   component: PremiumComponent,
 *   canActivate: [featureFlagGuard],
 *   data: {
 *     featureFlag: 'premium-feature',
 *     featureFlagRedirect: '/upgrade'
 *   }
 * }
 * ```
 */
export const featureFlagGuard: CanActivateFn = async (
  route: ActivatedRouteSnapshot,
) => {
  const toggly = inject(TogglyService)
  const router = inject(Router)

  const flag: string[] = Array.isArray(route.data['featureFlag'])
    ? route.data['featureFlag']
    : [route.data['featureFlag']]
  const requirement: 'all' | 'any' = route.data['featureFlagRequirement'] ?? 'all'
  const negate: boolean = route.data['featureFlagNegate'] ?? false
  const redirectUrl: string = route.data['featureFlagRedirect'] ?? '/'

  const isEnabled = await toggly.evaluateFeatureGate(flag, requirement, negate)

  if (isEnabled) {
    return true
  } else {
    return router.createUrlTree([redirectUrl])
  }
}

/**
 * Class-based route guard for feature flags (backward compatibility)
 *
 * @deprecated Use the functional `featureFlagGuard` instead for Angular 15+
 *
 * Usage in routes:
 * ```typescript
 * {
 *   path: 'premium',
 *   component: PremiumComponent,
 *   canActivate: [FeatureFlagGuard],
 *   data: {
 *     featureFlag: 'premium-feature',
 *     featureFlagRedirect: '/upgrade'
 *   }
 * }
 * ```
 */
@Injectable({
  providedIn: 'root',
})
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private toggly: TogglyService,
    private router: Router,
  ) {}

  async canActivate(next: ActivatedRouteSnapshot): Promise<boolean> {
    const flag: string[] = Array.isArray(next.data['featureFlag'])
      ? next.data['featureFlag']
      : [next.data['featureFlag']]
    const requirement: 'all' | 'any' = next.data['featureFlagRequirement'] ?? 'all'
    const negate: boolean = next.data['featureFlagNegate'] ?? false
    const redirectUrl: string = next.data['featureFlagRedirect'] ?? '/'

    const isEnabled = await this.toggly.evaluateFeatureGate(
      flag,
      requirement,
      negate,
    )

    if (isEnabled) {
      return true
    } else {
      this.router.navigate([redirectUrl])
      return false
    }
  }
}
