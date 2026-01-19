import { Directive, TemplateRef } from '@angular/core'

/**
 * Template directive for use with the FeatureComponent
 *
 * Usage:
 * ```html
 * <feature featureKey="my-feature">
 *   <ng-template featureTemplate>
 *     <p>This content is shown when the feature is enabled</p>
 *   </ng-template>
 * </feature>
 * ```
 */
@Directive({
  selector: '[featureTemplate]',
  standalone: true,
})
export class FeatureTemplateDirective {
  constructor(public templateRef: TemplateRef<unknown>) {}
}
