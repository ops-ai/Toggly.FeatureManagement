import {
  Component,
  ContentChild,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FeatureTemplateDirective } from './feature-template.directive'
import { TogglyService } from './toggly.service'

/**
 * Feature component for conditionally rendering content based on feature flags
 *
 * Usage with NgModule:
 * ```html
 * <feature featureKey="my-feature">
 *   <ng-template featureTemplate>
 *     <p>This content is shown when the feature is enabled</p>
 *   </ng-template>
 * </feature>
 * ```
 *
 * Usage with standalone (Angular 15+):
 * ```typescript
 * import { FeatureComponent, FeatureTemplateDirective } from '@ops-ai/ngx-feature-flags-toggly';
 *
 * @Component({
 *   standalone: true,
 *   imports: [FeatureComponent, FeatureTemplateDirective],
 *   template: `
 *     <feature featureKey="my-feature">
 *       <ng-template featureTemplate>
 *         <p>Feature content</p>
 *       </ng-template>
 *     </feature>
 *   `
 * })
 * ```
 */
@Component({
  selector: 'feature',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="shouldShow && content">
      <ng-container [ngTemplateOutlet]="content.templateRef"></ng-container>
    </ng-container>
  `,
  styles: [],
})
export class FeatureComponent implements OnChanges {
  @Input() featureKey: string | undefined
  @Input() featureKeys: string[] | undefined
  @Input() requirement: 'all' | 'any' = 'all'
  @Input() negate: boolean = false

  @ContentChild(FeatureTemplateDirective)
  content!: FeatureTemplateDirective

  shouldShow: boolean = false
  isLoading: boolean = false

  constructor(private toggly: TogglyService) {}

  ngOnChanges(changes: SimpleChanges): void {
    let gate: string[] = []

    if (this.featureKey) {
      gate.push(this.featureKey)
    }
    if (this.featureKeys) {
      gate = gate.concat(this.featureKeys)
    }

    this.isLoading = true

    // Check if we should show the feature during the evaluation of a feature flag
    this.shouldShow = this.toggly.shouldShowFeatureDuringEvaluation

    if (gate.length <= 0) {
      this.shouldShow = true
      this.isLoading = false
    } else {
      this.toggly
        .evaluateFeatureGate(gate, this.requirement, this.negate)
        .then((isEnabled) => (this.shouldShow = isEnabled))
        .finally(() => (this.isLoading = false))
    }
  }
}
