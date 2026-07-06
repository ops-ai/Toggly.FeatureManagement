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

    const apiBase = `${window.location.origin}/toggly-proxy`;

    TestBed.configureTestingModule({
      imports: [NgxFeatureFlagsTogglyModule.forRoot({
        appKey,
        environment: 'Production',
        // Same-origin Karma proxy avoids browser CORS in CI (see karma.conf.js)
        baseURI: apiBase,
      })],
    });

    const service = TestBed.inject(TogglyService);

    await expectAsync(service.isFeatureOn('FlagOn')).toBeResolvedTo(true);
    await expectAsync(service.isFeatureOff('FlagOff')).toBeResolvedTo(true);
  });
});
