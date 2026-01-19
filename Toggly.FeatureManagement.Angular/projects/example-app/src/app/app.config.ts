import { ApplicationConfig } from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideToggly } from '@ops-ai/ngx-feature-flags-toggly'
import { routes } from './app.routes'

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideToggly({
      // appKey: 'your-app-key', // You can find this in Toggly.io
      // environment: 'your-environment-name', // You can find this in Toggly.io
      appKey: '6460366e-6549-43e8-bbf8-23ff9745a6af',
      identity: 'unique-user-identifier', // Use this for personalized feature rollouts
      featureDefaults: {
        header: true,
        resources: true,
        nextSteps: true,
        feedback: true,
      },
    }),
  ],
}
