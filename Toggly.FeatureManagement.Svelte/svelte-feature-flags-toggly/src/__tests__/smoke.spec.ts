import { describe, it, expect } from 'vitest';
import { Toggly } from '../services/toggly.service';

describe('Smoke test', () => {
  const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

  it('loads live evaluated flags', async () => {
    if (!appKey) {
      return;
    }

    const service = new Toggly({
      appKey,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
      featureFlagsRefreshInterval: 0,
    });

    await expect(service.isFeatureOn('FlagOn')).resolves.toBe(true);
    await expect(service.isFeatureOff('FlagOff')).resolves.toBe(true);
  });
});
