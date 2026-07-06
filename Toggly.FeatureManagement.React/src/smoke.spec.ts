/**
 * @jest-environment node
 */
import Toggly from './services/toggly.service';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

describe('Smoke test', () => {
  test('loads live evaluated flags', async () => {
    if (!appKey) {
      console.warn('SKIPPED: TOGGLY_SMOKE_APP_KEY_FRONTEND not configured');
      return;
    }
    const service = new Toggly({
      appKey: appKey!,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
      enableLiveUpdates: false,
    });

    await expect(service.isFeatureOn('FlagOn')).resolves.toBe(true);
    await expect(service.isFeatureOff('FlagOff')).resolves.toBe(true);
  });
});
