import { Toggly } from '../lib/toggly';

describe('Smoke test', () => {
  const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

  beforeAll(async () => {
    if (!appKey) {
      return;
    }

    await Toggly.init({
      appKey,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
      featureFlagsRefreshInterval: 0,
    });
  });

  afterAll(() => {
    Toggly.cancelRefreshInterval();
  });

  test('loads live evaluated flags', () => {
    if (!appKey) {
      return;
    }

    expect(Toggly.isFeatureOn('FlagOn')).toBe(true);
    expect(Toggly.isFeatureOff('FlagOff')).toBe(true);
  });
});
