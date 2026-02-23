import { TogglyServerClient } from '../src/client';

describe('Smoke test', () => {
  const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

  it('loads live evaluated flags', async () => {
    if (!appKey) {
      return;
    }

    const client = new TogglyServerClient({
      appKey,
      environment: 'Production',
      baseUrl: 'https://definitions.toggly.io',
      timeout: 15000,
    });

    await client.init();

    await expect(client.isEnabled('FlagOn')).resolves.toBe(true);
    await expect(client.isDisabled('FlagOff')).resolves.toBe(true);
  });
});
