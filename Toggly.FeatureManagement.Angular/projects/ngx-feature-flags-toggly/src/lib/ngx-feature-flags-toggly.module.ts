import { ModuleWithProviders, NgModule } from '@angular/core'
import { FeatureComponent } from './feature.component'
import { TogglyOptions } from './toggly-options'
import { FeatureTemplateDirective } from './feature-template.directive'
import { FeatureFlagDirective } from './feature.directive'
import { FeatureFlagGuard } from './feature.guard'

/**
 * NgModule for Toggly feature flags
 *
 * Usage in AppModule:
 * ```typescript
 * import { NgxFeatureFlagsTogglyModule } from '@ops-ai/ngx-feature-flags-toggly';
 *
 * @NgModule({
 *   imports: [
 *     NgxFeatureFlagsTogglyModule.forRoot({
 *       appKey: 'your-app-key',
 *       environment: 'Production'
 *     })
 *   ]
 * })
 * export class AppModule {}
 * ```
 *
 * For standalone components (Angular 15+), you can import components directly:
 * ```typescript
 * import {
 *   FeatureComponent,
 *   FeatureFlagDirective,
 *   FeatureTemplateDirective,
 *   provideToggly
 * } from '@ops-ai/ngx-feature-flags-toggly';
 *
 * // In app.config.ts or main.ts
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideToggly({ appKey: 'your-app-key', environment: 'Production' })
 *   ]
 * });
 * ```
 */
@NgModule({
  imports: [
    FeatureComponent,
    FeatureTemplateDirective,
    FeatureFlagDirective,
  ],
  providers: [FeatureFlagGuard],
  exports: [
    FeatureComponent,
    FeatureTemplateDirective,
    FeatureFlagDirective,
  ],
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
