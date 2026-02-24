// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { initTogglyClient, $flags, __resetClient } from '../client/store.js';

describe('Smoke test', () => {
  const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

  beforeEach(() => {
    __resetClient();
  });

  it('loads live evaluated flags', async () => {
    if (!appKey) {
      return;
    }

    await initTogglyClient({
      appKey,
      environment: 'Production',
      baseURI: 'https://definitions.toggly.io',
      featureFlagsRefreshInterval: 0,
    });

    const flags = $flags.get();
    expect(flags.FlagOn).toBe(true);
    expect(flags.FlagOff ?? false).toBe(false);
  });
});
