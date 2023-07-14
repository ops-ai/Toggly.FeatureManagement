import { CanActivate, Router, ActivatedRouteSnapshot } from '@angular/router'
import { TogglyService } from './toggly.service'
import { Injectable } from '@angular/core'

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(private toggly: TogglyService, private router: Router) {}

  canActivate(next: ActivatedRouteSnapshot): Promise<boolean> {
    const flag: string[] = Array.isArray(next.data['featureFlag'])
      ? next.data['featureFlag']
      : [next.data['featureFlag']]
    const requirement: 'all' | 'any' = next.data['featureFlagRequirement']
    const negate: boolean = next.data['featureFlagNegate']
    const redirectUrl: string =
      (next.data['featureFlagRedirect'] as string) || '/'

    return new Promise((resolve) => {
      this.toggly
        .evaluateFeatureGate(flag, requirement, negate)
        .then((isEnabled) => {
          if (isEnabled) {
            resolve(true)
          } else {
            this.router.navigate([redirectUrl])
            resolve(false)
          }
        })
    })
  }
}
