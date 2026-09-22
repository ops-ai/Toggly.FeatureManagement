import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureComponent } from './feature.component';
import { FeatureFlagDirective } from './feature.directive';
import { FeatureGateBuilderDirective } from './feature-gate-builder.directive';
import { FeatureTemplateDirective } from './feature-template.directive';
import { FeatureVariantDirective } from './feature-variant.directive';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import { TogglyService } from './toggly.service';

@Component({
  standalone: true,
  imports: [FeatureComponent, FeatureTemplateDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <feature featureKey="Checkout">
      <ng-template featureTemplate><span class="checkout">Checkout</span></ng-template>
    </feature>
  `,
})
class ZonelessOnPushHostComponent {}

@Component({
  standalone: true,
  imports: [FeatureVariantDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span *featureVariant="'Checkout'; variant: 'control'" class="checkout-variant">
      Checkout variant
    </span>
  `,
})
class ZonelessVariantHostComponent {}

@Component({
  standalone: true,
  imports: [
    FeatureComponent,
    FeatureFlagDirective,
    FeatureGateBuilderDirective,
    FeatureTemplateDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <feature featureKey="Checkout">
      <ng-template featureTemplate><span class="remote-component">Component</span></ng-template>
    </feature>
    <span *featureFlag="'Checkout'" class="remote-directive">Directive</span>
    <button *featureGateBuilder="'Checkout'; let enabled" [class.enabled]="enabled">
      Gate builder
    </button>
  `,
})
class ZonelessRemoteRefreshHostComponent {}

describe('zoneless OnPush feature rendering', () => {
  let fixture: ComponentFixture<ZonelessOnPushHostComponent>;
  let toggly: TogglyService;

  beforeEach(() => {
    spyOn(console, 'warn');
    TestBed.configureTestingModule({
      imports: [
        ZonelessOnPushHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          featureDefaults: { Checkout: true },
        }),
      ],
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(ZonelessOnPushHostComponent);
    toggly = TestBed.inject(TogglyService);
  });

  it('renders a local-gate change without a host detectChanges call', async () => {
    fixture.detectChanges();
    await toggly.isFeatureOn('Checkout');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.checkout')).toBeTruthy();

    toggly.setLocalGates([{
      id: 'checkout-kill-switch',
      flagKeys: ['Checkout'],
      isEnabled: () => false,
    }]);
    toggly.notifyLocalGatesChanged();

    await toggly.isFeatureOn('Checkout');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.checkout')).toBeNull();
  });
});

describe('zoneless OnPush variant rendering', () => {
  it('renders a local-gate change without a host detectChanges call', async () => {
    spyOn(console, 'warn');
    spyOn(globalThis, 'fetch').and.resolveTo({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({
        Checkout: { enabled: true, variant: 'control', configurationValue: null },
      }),
      text: () => Promise.resolve(JSON.stringify({
        Checkout: { enabled: true, variant: 'control', configurationValue: null },
      })),
    } as Response);
    TestBed.configureTestingModule({
      imports: [
        ZonelessVariantHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          enableTelemetry: false, appKey: 'zoneless-variant',
          environment: 'Production',
          enableVariants: true,
          persistCache: false,
        }),
      ],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(ZonelessVariantHostComponent);
    const toggly = TestBed.inject(TogglyService);

    fixture.detectChanges();
    await toggly.getVariant('Checkout');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.checkout-variant')).toBeTruthy();

    toggly.setLocalGates([{
      id: 'checkout-variant-kill-switch',
      flagKeys: ['Checkout'],
      isEnabled: () => false,
    }]);
    toggly.notifyLocalGatesChanged();

    await toggly.getVariant('Checkout');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.checkout-variant')).toBeNull();
  });
});

describe('zoneless OnPush remote refresh rendering', () => {
  it('renders a refreshed flag state without a host detectChanges call', async () => {
    spyOn(console, 'warn');
    let definitions = { Checkout: true };
    spyOn(globalThis, 'fetch').and.callFake(() => Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(definitions),
      text: () => Promise.resolve(JSON.stringify(definitions)),
    } as Response));
    TestBed.configureTestingModule({
      imports: [
        ZonelessRemoteRefreshHostComponent,
        NgxFeatureFlagsTogglyModule.forRoot({
          customDefinitionsUrl: 'https://definitions.example.test/flags',
          persistCache: false,
        }),
      ],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(ZonelessRemoteRefreshHostComponent);
    const toggly = TestBed.inject(TogglyService);

    fixture.detectChanges();
    await (toggly as unknown as { _loadFeatures: (force: boolean) => Promise<void> })._loadFeatures(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.remote-component')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.remote-directive')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button').classList.contains('enabled')).toBe(true);

    definitions = { Checkout: false };
    await (toggly as unknown as { _loadFeatures: (force: boolean) => Promise<void> })._loadFeatures(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.remote-component')).toBeNull();
    expect(fixture.nativeElement.querySelector('.remote-directive')).toBeNull();
    expect(fixture.nativeElement.querySelector('button').classList.contains('enabled')).toBe(false);
  });
});
