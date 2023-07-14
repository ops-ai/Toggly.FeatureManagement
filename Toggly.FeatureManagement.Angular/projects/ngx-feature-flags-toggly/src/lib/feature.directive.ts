import {
  Directive,
  Input,
  OnInit,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core'
import { TogglyService } from './toggly.service'

@Directive({
  selector: '[featureFlag]',
})
export class FeatureFlagDirective implements OnInit {
  private flag: string[] = []
  private isHidden = true

  @Input() set featureFlag(value: string | string[]) {
    if (value) {
      if (typeof value === 'string') {
        this.flag.push(value)
      } else if (Array.isArray(value)) {
        this.flag = value
      }

      this.updateView()
    }
  }
  @Input('featureFlagRequirement') requirement: string = 'all'
  @Input('featureFlagNegate') negate: boolean = false

  constructor(
    private _templateRef: TemplateRef<any>,
    private _viewContainer: ViewContainerRef,
    private _toggly: TogglyService,
  ) {}

  ngOnInit() {
    this.updateView()
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
