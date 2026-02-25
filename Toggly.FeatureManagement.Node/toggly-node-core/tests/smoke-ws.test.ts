// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createTogglyClient } from '../src/client.js';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_BACKEND;

describe.skipIf(!appKey)('WebSocket smoke test', () => {
  it('connects via WebSocket and receives live updates', async () => {
    const client = createTogglyClient({
      appKey: appKey!,
      environment: 'Production',
      baseUrl: 'https://definitions.toggly.io',
      enableStreaming: true,
      refreshInterval: 0,
      timeout: 15000,
    });

    await client.init();

    // Wait for WebSocket to connect (up to 10 seconds)
    const deadline = Date.now() + 10_000;
    while (!client.state.wsConnected && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }

    expect(client.state.wsConnected).toBe(true);
    await expect(client.isFeatureOn('FlagOn')).resolves.toBe(true);
    await expect(client.isFeatureOff('FlagOff')).resolves.toBe(true);

    client.close();
  }, 30_000);
});
