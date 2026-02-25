import { TogglyServerClient } from '../src/client';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

(appKey ? describe : describe.skip)('WebSocket smoke test', () => {
  it('connects via WebSocket and receives live updates', async () => {
    const client = new TogglyServerClient({
      appKey: appKey!,
      environment: 'Production',
      baseUrl: 'https://definitions.toggly.io',
      timeout: 15000,
    });

    await client.init();

    // Wait for WebSocket to connect (up to 10 seconds)
    const deadline = Date.now() + 10_000;
    while (!client.isWsConnected && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }

    expect(client.isWsConnected).toBe(true);
    await expect(client.isEnabled('FlagOn')).resolves.toBe(true);
    await expect(client.isDisabled('FlagOff')).resolves.toBe(true);

    client.close();
  }, 30_000);
});
