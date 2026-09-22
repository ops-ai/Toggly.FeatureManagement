import { ChangeDetectionStrategy, Component, NgZone } from '@angular/core';
import { Router, RouterLink, RouterOutlet, provideRouter } from '@angular/router';
import { FeatureComponent, FeatureTemplateDirective, FeatureFlagDirective,
  FeatureGateBuilderDirective, FeatureVariantDirective, FeatureFlagGuard,
  featureFlagGuard, provideToggly, TogglyService } from '@ops-ai/ngx-feature-flags-toggly';

@Component({ standalone: true, template: '<p id="protected">Protected</p>' })
class ProtectedComponent {}
@Component({ standalone: true, template: '<p id="denied">Denied</p>' })
class DeniedComponent {}

@Component({
  selector: 'app-root', standalone: true,
  imports: [FeatureComponent, FeatureTemplateDirective, FeatureFlagDirective,
    FeatureGateBuilderDirective, FeatureVariantDirective, RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button id="input" (click)="flag = flag === 'Checkout' ? 'Disabled' : 'Checkout'">Change input</button>
    <feature [featureKey]="flag"><ng-template featureTemplate><span id="component">Component</span></ng-template></feature>
    <span *featureFlag="flag" id="flag">Flag</span>
    <span *featureGateBuilder="flag; let enabled" id="builder">{{ enabled }}</span>
    <span *featureVariant="flag; variant: 'control'" id="variant">Variant</span>
    <a id="function-route" routerLink="/function">Functional guard</a>
    <a id="class-route" routerLink="/class">Class guard</a>
    <a id="home" routerLink="/">Home</a>
    <router-outlet></router-outlet>
  `,
})
export class AppComponent {
  flag = 'Checkout';
  constructor(service: TogglyService, zone: NgZone, router: Router) {
    // Browser driver invokes real public SDK APIs outside Angular's event handler.
    // This distinguishes SDK async change notification from host click scheduling.
    Object.assign(window, {
      setLocal: (enabled: boolean) => zone.run(() => {
        service.setLocalGates([{ id: 'device', flagKeys: ['Checkout'], isEnabled: () => enabled }]);
        service.notifyLocalGatesChanged();
      }),
      setContext: (identity: string) => zone.run(() => service.setContext({ identity, groups: ['fixture'], claims: { role: 'test' } })),
      setInstance: (instanceId: string) => zone.run(() => service.setContext({ instanceId })),
      flushTelemetry: () => service.flushTelemetry(),
      recordTelemetry: () => { service.recordUsage('Checkout', 'control'); service.recordView('Checkout'); service.incrementCounter('orders', 2); service.setGauge('cart', 3); },
      navigate: (url: string) => zone.run(() => router.navigateByUrl(url)),
    });
  }
}

export const providers = [
  provideRouter([
    { path: 'function', component: ProtectedComponent, canActivate: [featureFlagGuard], data: { featureFlag: 'Checkout', featureFlagRedirect: '/denied' } },
    { path: 'class', component: ProtectedComponent, canActivate: [FeatureFlagGuard], data: { featureFlag: 'Checkout', featureFlagRedirect: '/denied' } },
    { path: 'denied', component: DeniedComponent },
  ]),
  provideToggly({ metricsBaseUrl: new URLSearchParams(window.location.search).get('metrics') ?? window.location.origin, baseURI: window.location.origin, appKey: 'fixture', environment: 'Test', enableVariants: true, persistCache: false }),
];
