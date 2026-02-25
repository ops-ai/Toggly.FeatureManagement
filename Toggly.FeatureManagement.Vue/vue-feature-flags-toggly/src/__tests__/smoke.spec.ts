import { describe, it, expect } from 'vitest';
import { Toggly } from '../plugins/toggly.service';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

describe.skipIf(!appKey)('Smoke test', () => {
  it('loads live evaluated flags', async () => {
    const service = new Toggly().init({
      appKey: appKey!,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
    });

    await expect(service.isFeatureOn('FlagOn')).resolves.toBe(true);
    await expect(service.isFeatureOff('FlagOff')).resolves.toBe(true);
  });
});
