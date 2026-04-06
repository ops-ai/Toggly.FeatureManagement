import {
  Directive,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core'
import { TogglyService } from './toggly.service'

/**
 * Structural directive for rendering content when a feature's assigned variant matches.
 *
 * Requires `enableVariants: true` in Toggly configuration.
 *
 * Usage with NgModule:
 * ```html
 * <div *featureVariant="'my-feature'; variant: 'control'">
 *   Shown when my-feature is assigned the "control" variant
 * </div>
 * ```
 *
 * Usage with standalone (Angular 15+):
 * ```typescript
 * import { FeatureVariantDirective } from '@ops-ai/ngx-feature-flags-toggly';
 *
 * @Component({
 *   standalone: true,
 *   imports: [FeatureVariantDirective],
 *   template: `
 *     <div *featureVariant="'my-feature'; variant: 'treatment-a'">Variant content</div>
 *   `
 * })
 * ```
 */
@Directive({
  selector: '[featureVariant]',
  standalone: true,
})
export class FeatureVariantDirective implements OnInit, OnChanges {
  private isHidden = true

  @Input() featureVariant = ''
  /** Bound via microsyntax: `*featureVariant="'key'; variant: 'name'"` → `featureVariantVariant` */
  @Input('featureVariantVariant') variant = ''

  constructor(
    private _templateRef: TemplateRef<unknown>,
    private _viewContainer: ViewContainerRef,
    private _toggly: TogglyService,
  ) {}

  ngOnInit(): void {
    this.updateView()
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.updateView()
  }

  private updateView(): void {
    if (!this.featureVariant || !this.variant) {
      this._viewContainer.clear()
      this.isHidden = true
      return
    }

    this._toggly.getVariant(this.featureVariant).then((result) => {
      const matches = result !== null && result.name === this.variant
      if (matches) {
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
