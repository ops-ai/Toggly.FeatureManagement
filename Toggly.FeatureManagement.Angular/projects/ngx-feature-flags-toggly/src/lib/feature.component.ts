import {
  Component,
  ContentChild,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FeatureTemplateDirective } from './feature-template.directive'
import { TogglyService } from './toggly.service'
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types'

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
 *
 * Entity context (parity with `*featureFlag`):
 * ```html
 * <feature featureKey="OrderBadge" [context]="order" contextKind="Order">
 *   <ng-template featureTemplate>
 *     <app-badge />
 *   </ng-template>
 * </feature>
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
export class FeatureComponent implements OnChanges, OnInit, OnDestroy {
  @Input() featureKey: string | undefined
  @Input() featureKeys: string[] | undefined
  @Input() requirement: 'all' | 'any' = 'all'
  @Input() negate: boolean = false
  /** Entity instance or canonical entity context for entity-gated flags */
  @Input() context: TogglyEntityContext | Record<string, unknown> | null = null
  /** Context kind for registerContext mapper lookup when `context` is a domain object */
  @Input() contextKind: string | undefined
  /** Alias for {@link contextKind} to match `*featureFlag` microsyntax `kind` */
  @Input() kind: string | undefined

  @ContentChild(FeatureTemplateDirective)
  content!: FeatureTemplateDirective

  shouldShow: boolean = false
  isLoading: boolean = false
  private unsubscribeFeaturesRefresh: (() => void) | undefined
  private unsubscribeLocalGates: (() => void) | undefined

  constructor(private toggly: TogglyService) {}

  ngOnInit(): void {
    this.unsubscribeFeaturesRefresh = this.toggly.subscribeFeaturesRefresh(() => {
      this.updateVisibility()
    })
    this.unsubscribeLocalGates = this.toggly.subscribeLocalGatesChanged(() => {
      this.updateVisibility()
    })
  }

  ngOnDestroy(): void {
    this.unsubscribeFeaturesRefresh?.()
    this.unsubscribeLocalGates?.()
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.updateVisibility()
  }

  private updateVisibility(): void {
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
      this.shouldShow = !this.negate
      this.isLoading = false
    } else {
      const kind = this.contextKind ?? this.kind
      this.toggly
        .evaluateFeatureGate(gate, this.requirement, this.negate, this.context, kind)
        .then((isEnabled) => (this.shouldShow = isEnabled))
        .finally(() => (this.isLoading = false))
    }
  }
}
