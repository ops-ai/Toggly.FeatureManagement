import { ModuleWithProviders, NgModule } from '@angular/core'
import { FeatureComponent } from './feature.component'
import { TogglyOptions } from './toggly-options'
import { FeatureTemplateDirective } from './feature-template.directive'
import { CommonModule } from '@angular/common'

@NgModule({
  declarations: [FeatureComponent, FeatureTemplateDirective],
  imports: [CommonModule],
  exports: [FeatureComponent, FeatureTemplateDirective],
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
