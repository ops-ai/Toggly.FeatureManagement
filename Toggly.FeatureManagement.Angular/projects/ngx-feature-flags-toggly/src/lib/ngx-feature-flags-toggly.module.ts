import { ModuleWithProviders, NgModule } from '@angular/core'
import { FeatureComponent } from './feature.component'
import { TogglyOptions } from './toggly-options'
import { FeatureTemplateDirective } from './feature-template.directive'
import { CommonModule } from '@angular/common'
import { FeatureFlagDirective } from './feature.directive'
import { FeatureFlagGuard } from './feature.guard'

@NgModule({
  declarations: [
    FeatureComponent,
    FeatureTemplateDirective,
    FeatureFlagDirective,
  ],
  imports: [CommonModule],
  providers: [FeatureFlagGuard],
  exports: [FeatureComponent, FeatureTemplateDirective, FeatureFlagDirective],
})
export class NgxFeatureFlagsTogglyModule {
  static forRoot(
    config: TogglyOptions,
  ): ModuleWithProviders<NgxFeatureFlagsTogglyModule> {
    return {
      ngModule: NgxFeatureFlagsTogglyModule,
      providers: [
        {
          provide: TogglyOptions,
          useValue: config,
        },
      ],
    }
  }
}
