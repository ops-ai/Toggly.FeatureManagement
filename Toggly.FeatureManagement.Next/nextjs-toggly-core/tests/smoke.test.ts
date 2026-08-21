import { describe, it, expect } from 'vitest';
import { createTogglyClient } from '../src/client';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

describe('Smoke test', () => {
  it('loads live evaluated flags', { timeout: 15000 }, async () => {
    if (!appKey) throw new Error('TOGGLY_SMOKE_APP_KEY_FRONTEND is not configured — set this env var to run smoke tests');
    const client = createTogglyClient({
      appKey: appKey!,
      environment: 'Production',
      baseUri: 'https://definitions.toggly.io',
      refreshInterval: 0,
    });

    await client.init();

    await expect(client.isFeatureOn('FlagOn')).resolves.toBe(true);
    await expect(client.isFeatureOff('FlagOff')).resolves.toBe(true);
  });
});
