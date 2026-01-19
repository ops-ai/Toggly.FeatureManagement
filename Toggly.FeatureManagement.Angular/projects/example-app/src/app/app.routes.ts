import { Routes } from '@angular/router'
import { featureFlagGuard } from '@ops-ai/ngx-feature-flags-toggly'

export const routes: Routes = [
  // Example: Feature-gated route
  // {
  //   path: 'premium',
  //   loadComponent: () => import('./premium/premium.component').then(m => m.PremiumComponent),
  //   canActivate: [featureFlagGuard],
  //   data: {
  //     featureFlag: 'premium-feature',
  //     featureFlagRedirect: '/upgrade',
  //   },
  // },
  //
  // Example: Route requiring ANY of multiple features
  // {
  //   path: 'beta',
  //   loadComponent: () => import('./beta/beta.component').then(m => m.BetaComponent),
  //   canActivate: [featureFlagGuard],
  //   data: {
  //     featureFlag: ['beta-tester', 'internal-user'],
  //     featureFlagRequirement: 'any',
  //     featureFlagRedirect: '/',
  //   },
  // },
]
