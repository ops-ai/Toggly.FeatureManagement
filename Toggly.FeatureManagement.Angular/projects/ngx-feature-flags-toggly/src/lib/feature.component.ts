import {
  Component,
  ContentChild,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core'
import { FeatureTemplateDirective } from './feature-template.directive'
import { TogglyService } from './toggly.service'

@Component({
  selector: 'feature',
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
  @Input() requirement: string = 'all'
  @Input() negate: boolean = false
  @ContentChild(FeatureTemplateDirective)
  content!: FeatureTemplateDirective

  shouldShow: boolean = false
  isLoading: boolean = false

  constructor(private toggly: TogglyService) {}

  ngOnChanges(changes: SimpleChanges): void {
    var gate: string[] = []
    if (this.featureKey) {
      gate.push(this.featureKey)
    }
    if (this.featureKeys) {
      gate = gate.concat(this.featureKeys as string[])
    }

    // // Check for misusage
    // if (!this.content) {
    //   console.error(
    //     `Toggly --- Missing template for feature with the following feature keys: "${gate.join(
    //       ', ',
    //     )}". You can provide a template using <ng-template featureTemplate>...</ng-template>.`,
    //   )
    // }

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
