import { NgModule } from '@angular/core'
import { RouterModule, Routes } from '@angular/router'
import { FeatureFlagGuard } from 'dist/ngx-feature-flags-toggly/public-api'

const routes: Routes = [
  // {
  //   path: 'experimental-route',
  //   loadChildren: () =>
  //     import('/path/to/module').then((module) => module.ExperimentalModuleName),
  //   canActivate: [FeatureFlagGuard],
  //   data: {
  //     featureFlag: 'firstFeature',
  //     featureFlagRequirement: 'any',
  //     featureFlagNegate: true,
  //     featureFlagRedirect: '/path/for/redirect',
  //   },
  // },
]

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
