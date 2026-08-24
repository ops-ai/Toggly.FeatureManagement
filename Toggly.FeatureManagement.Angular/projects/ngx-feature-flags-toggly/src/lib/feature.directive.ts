import {
  Directive,
  Input,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core'
import { TogglyService } from './toggly.service'
import type { TogglyEntityContext } from '@ops-ai/toggly-hooks-types'

/**
 * Structural directive for conditionally rendering content based on feature flags
 *
 * Usage with NgModule:
 * ```html
 * <div *featureFlag="'my-feature'">
 *   This content is shown when the feature is enabled
 * </div>
 * ```
 *
 * Usage with standalone (Angular 15+):
 * ```typescript
 * import { FeatureFlagDirective } from '@ops-ai/ngx-feature-flags-toggly';
 *
 * @Component({
 *   standalone: true,
 *   imports: [FeatureFlagDirective],
 *   template: `
 *     <div *featureFlag="'my-feature'">Feature content</div>
 *   `
 * })
 * ```
 *
 * Advanced usage with multiple features:
 * ```html
 * <div *featureFlag="['feature-a', 'feature-b']; requirement: 'any'">
 *   Shown when any feature is enabled
 * </div>
 * ```
 */
@Directive({
  selector: '[featureFlag]',
  standalone: true,
})
export class FeatureFlagDirective implements OnInit, OnDestroy {
  private flag: string[] = []
  private isHidden = true
  private entityContext: TogglyEntityContext | Record<string, unknown> | null = null
  private kind: string | undefined
  private unsubscribeLocalGates: (() => void) | undefined
  private unsubscribeFeaturesRefresh: (() => void) | undefined

  @Input() set featureFlag(value: string | string[]) {
    if (typeof value === 'string') {
      this.flag = value ? [value] : []
    } else if (Array.isArray(value)) {
      this.flag = value
    } else {
      this.flag = []
    }

    this.updateView()
  }

  private requirement: 'all' | 'any' = 'all'
  private negate = false

  // eslint-disable-next-line @angular-eslint/no-input-rename -- structural directive alias
  @Input('featureFlagRequirement')
  set featureFlagRequirement(value: 'all' | 'any') {
    this.requirement = value ?? 'all'
    this.updateView()
  }

  // eslint-disable-next-line @angular-eslint/no-input-rename -- structural directive alias
  @Input('featureFlagNegate')
  set featureFlagNegate(value: boolean) {
    this.negate = value ?? false
    this.updateView()
  }

  // eslint-disable-next-line @angular-eslint/no-input-rename -- structural directive alias
  @Input('featureFlagContext')
  set featureFlagContext(value: TogglyEntityContext | Record<string, unknown> | null) {
    this.entityContext = value
    this.updateView()
  }

  // eslint-disable-next-line @angular-eslint/no-input-rename -- structural directive alias
  @Input('featureFlagKind')
  set featureFlagKind(value: string | undefined) {
    this.kind = value
    this.updateView()
  }

  constructor(
    private _templateRef: TemplateRef<unknown>,
    private _viewContainer: ViewContainerRef,
    private _toggly: TogglyService,
  ) {}

  ngOnInit() {
    this.updateView()
    this.unsubscribeLocalGates = this._toggly.subscribeLocalGatesChanged(() => {
      this.updateView()
    })
    this.unsubscribeFeaturesRefresh = this._toggly.subscribeFeaturesRefresh(() => {
      this.updateView()
    })
  }

  ngOnDestroy() {
    this.unsubscribeLocalGates?.()
    this.unsubscribeFeaturesRefresh?.()
  }

  private updateView() {
    this._toggly
      .evaluateFeatureGate(this.flag, this.requirement, this.negate, this.entityContext, this.kind)
      .then((isEnabled) => {
        if (isEnabled) {
          if (this.isHidden) {
            this._viewContainer.createEmbeddedView(this._templateRef)
            this.isHidden = false
          }
        } else {
          this._viewContainer.clear()
          this.isHidden = true
        }
      })
  }
}
