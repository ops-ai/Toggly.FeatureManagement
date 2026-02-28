import Toggly from './services/toggly.service';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

describe('Smoke test', () => {
  test('loads live evaluated flags', async () => {
    if (!appKey) throw new Error('TOGGLY_SMOKE_APP_KEY_FRONTEND is not configured — set this env var to run smoke tests');
    const service = new Toggly({
      appKey: appKey!,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
    });

    await expect(service.isFeatureOn('FlagOn')).resolves.toBe(true);
    await expect(service.isFeatureOff('FlagOff')).resolves.toBe(true);
  });
});
