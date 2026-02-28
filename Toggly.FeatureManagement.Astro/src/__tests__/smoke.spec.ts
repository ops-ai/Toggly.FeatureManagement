// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { initTogglyClient, $flags, __resetClient } from '../client/store.js';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

describe('Smoke test', () => {
  beforeEach(() => {
    __resetClient();
  });

  it('loads live evaluated flags', async () => {
    if (!appKey) throw new Error('TOGGLY_SMOKE_APP_KEY_FRONTEND is not configured — set this env var to run smoke tests');
    await initTogglyClient({
      appKey: appKey!,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
      featureFlagsRefreshInterval: 0,
    });

    const flags = $flags.get();
    expect(flags.FlagOn).toBe(true);
    expect(flags.FlagOff ?? false).toBe(false);
  });
});
