import {
  Directive,
  EmbeddedViewRef,
  Input,
  OnDestroy,
  OnInit,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core'
import { TogglyService } from './toggly.service'

/**
 * Structural directive that always renders its template and exposes the resolved gate boolean.
 *
 * @example
 * ```html
 * <button
 *   *featureGateBuilder="'PremiumCheckout'; let enabled"
 *   [class.active]="enabled"
 * >
 *   Sales
 * </button>
 * ```
 */
@Directive({
  selector: '[featureGateBuilder]',
  standalone: true,
})
export class FeatureGateBuilderDirective implements OnInit, OnDestroy {
  private flag: string[] = []
  private viewRef?: EmbeddedViewRef<{ $implicit: boolean; enabled: boolean }>
  private unsubscribeLocalGates: (() => void) | undefined
  private unsubscribeFeaturesRefresh: (() => void) | undefined

  @Input() set featureGateBuilder(value: string | string[]) {
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

  @Input('featureGateBuilderRequirement')
  set featureGateBuilderRequirement(value: 'all' | 'any') {
    this.requirement = value ?? 'all'
    this.updateView()
  }

  @Input('featureGateBuilderNegate')
  set featureGateBuilderNegate(value: boolean) {
    this.negate = value ?? false
    this.updateView()
  }

  constructor(
    private readonly templateRef: TemplateRef<{ $implicit: boolean; enabled: boolean }>,
    private readonly viewContainer: ViewContainerRef,
    private readonly toggly: TogglyService,
  ) {}

  ngOnInit(): void {
    this.updateView()
    this.unsubscribeLocalGates = this.toggly.subscribeLocalGatesChanged(() => {
      this.updateView()
    })
    this.unsubscribeFeaturesRefresh = this.toggly.subscribeFeaturesRefresh(() => {
      this.updateView()
    })
  }

  ngOnDestroy(): void {
    this.unsubscribeLocalGates?.()
    this.unsubscribeFeaturesRefresh?.()
    this.viewContainer.clear()
  }

  private updateView(): void {
    const evaluate = () => {
      if (this.flag.length === 0) {
        this.renderEnabled(!this.negate)
        return
      }

      this.toggly
        .evaluateFeatureGate(this.flag, this.requirement, this.negate)
        .then((isEnabled) => this.renderEnabled(isEnabled))
    }

    evaluate()
  }

  private renderEnabled(isEnabled: boolean): void {
    if (!this.viewRef) {
      this.viewRef = this.viewContainer.createEmbeddedView(this.templateRef, {
        $implicit: isEnabled,
        enabled: isEnabled,
      })
      return
    }

    this.viewRef.context.$implicit = isEnabled
    this.viewRef.context.enabled = isEnabled
    this.viewRef.markForCheck()
  }
}
