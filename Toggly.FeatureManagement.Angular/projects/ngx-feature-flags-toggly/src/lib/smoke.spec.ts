import { TestBed } from '@angular/core/testing';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import { TogglyService } from './toggly.service';

describe('Smoke test', () => {
  const appKey = (globalThis as any).process?.env?.TOGGLY_SMOKE_APP_KEY_FRONTEND;

  it('loads live evaluated flags', async () => {
    if (!appKey) {
      return;
    }

    TestBed.configureTestingModule({
      imports: [NgxFeatureFlagsTogglyModule.forRoot({
        appKey,
        environment: 'Production',
        baseURI: 'https://definitions.toggly.io',
      })],
    });

    const service = TestBed.inject(TogglyService);

    await expectAsync(service.isFeatureOn('FlagOn')).toBeResolvedTo(true);
    await expectAsync(service.isFeatureOff('FlagOff')).toBeResolvedTo(true);
  });
});
