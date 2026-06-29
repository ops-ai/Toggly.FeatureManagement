import {
  Directive,
  Input,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core'
import { TogglyService } from './toggly.service'

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
  private unsubscribeLocalGates: (() => void) | undefined

  @Input() set featureFlag(value: string | string[]) {
    if (value) {
      if (typeof value === 'string') {
        this.flag = [value]
      } else if (Array.isArray(value)) {
        this.flag = value
      }

      this.updateView()
    }
  }

  @Input('featureFlagRequirement') requirement: 'all' | 'any' = 'all'
  @Input('featureFlagNegate') negate: boolean = false

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
  }

  ngOnDestroy() {
    this.unsubscribeLocalGates?.()
  }

  private updateView() {
    this._toggly
      .evaluateFeatureGate(this.flag, this.requirement, this.negate)
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
