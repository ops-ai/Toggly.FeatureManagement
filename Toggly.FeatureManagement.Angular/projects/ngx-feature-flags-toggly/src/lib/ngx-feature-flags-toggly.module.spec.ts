import { TestBed } from '@angular/core/testing';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import { TogglyOptions, provideToggly } from './toggly-options';
import { TogglyService } from './toggly.service';

describe('NgxFeatureFlagsTogglyModule', () => {
  beforeEach(() => {
    spyOn(console, 'warn');
  });

  it('should provide TogglyOptions via forRoot', () => {
    TestBed.configureTestingModule({
      imports: [NgxFeatureFlagsTogglyModule.forRoot({
        featureDefaults: { F1: true },
      })],
    });
    const config = TestBed.inject(TogglyOptions);
    expect(config).toBeTruthy();
    expect(config.featureDefaults).toEqual({ F1: true });
  });

  it('should create TogglyService with forRoot config', () => {
    TestBed.configureTestingModule({
      imports: [NgxFeatureFlagsTogglyModule.forRoot({
        featureDefaults: { F1: true },
      })],
    });
    const service = TestBed.inject(TogglyService);
    expect(service).toBeTruthy();
  });

  it('should return ModuleWithProviders', () => {
    const result = NgxFeatureFlagsTogglyModule.forRoot({
      featureDefaults: { F1: true },
    });
    expect(result.ngModule).toBe(NgxFeatureFlagsTogglyModule);
    expect(result.providers).toBeTruthy();
    expect(result.providers!.length).toBeGreaterThan(0);
  });
});

describe('provideToggly', () => {
  beforeEach(() => {
    spyOn(console, 'warn');
  });

  it('should create a Provider', () => {
    const provider = provideToggly({ featureDefaults: { F1: true } });
    expect(provider).toBeTruthy();
  });

  it('should provide TogglyOptions for standalone apps', () => {
    TestBed.configureTestingModule({
      providers: [provideToggly({ featureDefaults: { F1: true } })],
    });
    const config = TestBed.inject(TogglyOptions);
    expect(config.featureDefaults).toEqual({ F1: true });
  });

  it('should allow TogglyService creation in standalone context', async () => {
    TestBed.configureTestingModule({
      providers: [provideToggly({ featureDefaults: { F1: true } })],
    });
    const service = TestBed.inject(TogglyService);
    const result = await service.isFeatureOn('F1');
    expect(result).toBe(true);
  });
});
