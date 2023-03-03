import { Directive, TemplateRef } from '@angular/core'

@Directive({
  selector: '[featureTemplate]',
})
export class FeatureTemplateDirective {
  constructor(public templateRef: TemplateRef<unknown>) {}
}
