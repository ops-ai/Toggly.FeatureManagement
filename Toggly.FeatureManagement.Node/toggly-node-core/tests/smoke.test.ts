import { describe, it, expect } from 'vitest';
import { createTogglyClient } from '../src/client.js';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_BACKEND;

describe('Smoke test', () => {
  it('loads live evaluated flags', async () => {
    if (!appKey) throw new Error('TOGGLY_SMOKE_APP_KEY_BACKEND is not configured — set this env var to run smoke tests');
    const client = createTogglyClient({
      appKey: appKey!,
      environment: 'Production',
      baseUrl: 'https://definitions.toggly.io',
      refreshInterval: 0,
      timeout: 15000,
    });

    await client.init();

    await expect(client.isFeatureOn('FlagOn')).resolves.toBe(true);
    await expect(client.isFeatureOff('FlagOff')).resolves.toBe(true);

    client.close();
  });
});
