import { TestBed } from '@angular/core/testing';
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module';
import { TogglyService } from './toggly.service';

describe('Smoke test', () => {
  let appKey: string;

  beforeAll(() => {
    appKey = (globalThis as any).__karma__?.config?.smokeAppKey || '';
  });

  it('loads live evaluated flags', async () => {
    if (!appKey) {
      pending('TOGGLY_SMOKE_APP_KEY_FRONTEND not configured');
      return;
    }

    TestBed.configureTestingModule({
      imports: [NgxFeatureFlagsTogglyModule.forRoot({
        appKey,
        environment: 'Production',
        // Karma proxy (karma.conf.js) avoids browser CORS in CI
        baseURI: '/toggly-proxy',
      })],
    });

    const service = TestBed.inject(TogglyService);

    await expectAsync(service.isFeatureOn('FlagOn')).toBeResolvedTo(true);
    await expectAsync(service.isFeatureOff('FlagOff')).toBeResolvedTo(true);
  });
});
