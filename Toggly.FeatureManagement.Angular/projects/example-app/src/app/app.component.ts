import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterOutlet } from '@angular/router'
import {
  FeatureComponent,
  FeatureTemplateDirective,
  FeatureFlagDirective,
  TogglyService,
} from '@ops-ai/ngx-feature-flags-toggly'
import { TestProjectionInitComponent } from './test.component'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    FeatureComponent,
    FeatureTemplateDirective,
    FeatureFlagDirective,
    TestProjectionInitComponent,
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'example-app'

  private toggly = inject(TogglyService)

  constructor() {
    this.checkFeatures()
  }

  private async checkFeatures() {
    try {
      const headerEnabled = await this.toggly.isFeatureOn('header')
      console.info(
        `Feature "header" should ${headerEnabled ? 'be' : 'NOT be'} visible`,
      )

      const resourcesEnabled = await this.toggly.isFeatureOn('resources')
      console.info(
        `Feature "resources" should ${resourcesEnabled ? 'be' : 'NOT be'} visible`,
      )

      const nextStepsEnabled = await this.toggly.isFeatureOn('nextSteps')
      console.info(
        `Feature "nextSteps" should ${nextStepsEnabled ? 'be' : 'NOT be'} visible`,
      )

      const feedbackEnabled = await this.toggly.isFeatureOn('feedback')
      console.info(
        `Feature "feedback" should ${feedbackEnabled ? 'be' : 'NOT be'} visible`,
      )
    } catch (error) {
      console.error('Error checking features:', error)
    }
  }
}
