import { TogglyServerClient } from '../src/client';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

(appKey ? describe : describe.skip)('Smoke test', () => {
  it('loads live evaluated flags', async () => {
    const client = new TogglyServerClient({
      appKey: appKey!,
      environment: 'Production',
      baseUrl: 'https://definitions.toggly.io',
      timeout: 15000,
    });

    await client.init();

    await expect(client.isEnabled('FlagOn')).resolves.toBe(true);
    await expect(client.isDisabled('FlagOff')).resolves.toBe(true);
  });
});
