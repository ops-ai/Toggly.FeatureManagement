import { Component } from '@angular/core'
import { TogglyService } from 'projects/ngx-feature-flags-toggly/src/public-api'

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'example-app'

  constructor(private toggly: TogglyService) {
    try {
      this.toggly
        .isFeatureOn('header')
        .then((isEnabled) =>
          console.info(
            `Feature "header" should ${isEnabled ? 'be' : 'NOT be'} visible`,
          ),
        )

      this.toggly
        .isFeatureOn('resources')
        .then((isEnabled) =>
          console.info(
            `Feature "resources" should ${isEnabled ? 'be' : 'NOT be'} visible`,
          ),
        )

      this.toggly
        .isFeatureOn('nextSteps')
        .then((isEnabled) =>
          console.info(
            `Feature "nextSteps" should ${isEnabled ? 'be' : 'NOT be'} visible`,
          ),
        )

      this.toggly
        .isFeatureOn('feedback')
        .then((isEnabled) =>
          console.info(
            `Feature "feedback" should ${isEnabled ? 'be' : 'NOT be'} visible`,
          ),
        )
    } catch (error) {}
  }
}
