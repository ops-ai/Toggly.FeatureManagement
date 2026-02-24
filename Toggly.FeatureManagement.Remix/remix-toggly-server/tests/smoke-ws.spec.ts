import { TogglyServerClient } from '../src/client';

describe('WebSocket smoke test', () => {
  const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

  it('connects via WebSocket and receives live updates', async () => {
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

    // Wait for WebSocket to connect (up to 10 seconds)
    const deadline = Date.now() + 10_000;
    while (!(client as any).wsConnected && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }

    expect((client as any).wsConnected).toBe(true);
    await expect(client.isEnabled('FlagOn')).resolves.toBe(true);
    await expect(client.isDisabled('FlagOff')).resolves.toBe(true);

    client.close();
  }, 30_000);
});
