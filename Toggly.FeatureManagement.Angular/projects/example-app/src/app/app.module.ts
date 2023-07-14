import { NgModule } from '@angular/core'
import { BrowserModule } from '@angular/platform-browser'

import { AppRoutingModule } from './app-routing.module'
import { AppComponent } from './app.component'

import { TestProjectionInitComponent } from './test.component'

// import { NgxFeatureFlagsTogglyModule } from 'projects/ngx-feature-flags-toggly/src/public-api'
import { NgxFeatureFlagsTogglyModule } from 'dist/ngx-feature-flags-toggly'

@NgModule({
  declarations: [AppComponent, TestProjectionInitComponent],
  imports: [
    BrowserModule,
    AppRoutingModule,
    NgxFeatureFlagsTogglyModule.forRoot({
      // appKey: 'your-app-key', // You can find this in Toggly.io
      // environment: 'your-environment-name', // You can find this in Toggly.io
      appKey: '6460366e-6549-43e8-bbf8-23ff9745a6af',
      identity: 'unique-user-identifier', // Use this in case you want to support custom feature rollouts
      featureDefaults: {
        header: true,
        resources: true,
        nextSteps: true,
        feedback: true,
      },
    }),
  ],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
