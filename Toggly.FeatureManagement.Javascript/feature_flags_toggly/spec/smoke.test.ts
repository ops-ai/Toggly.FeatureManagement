import { Toggly } from '../lib/toggly';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

(appKey ? describe : describe.skip)('Smoke test', () => {
  beforeAll(async () => {
    await Toggly.init({
      appKey: appKey!,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
      featureFlagsRefreshInterval: 0,
    });
  });

  afterAll(() => {
    Toggly.cancelRefreshInterval();
  });

  test('loads live evaluated flags', () => {
    expect(Toggly.isFeatureOn('FlagOn')).toBe(true);
    expect(Toggly.isFeatureOff('FlagOff')).toBe(true);
  });
});
