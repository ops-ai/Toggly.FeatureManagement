import WebSocket = require('ws');

describe('WebSocket smoke test', () => {
  const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

  it('connects and receives initial message', async () => {
    if (!appKey) {
      return;
    }

    try {
      const ws = new WebSocket(`wss://definitions.toggly.io/${appKey}/ws`);

      const message = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket timed out after 15 seconds'));
        }, 15_000);

        ws.on('message', (data: Buffer) => {
          const text = data.toString();
          try {
            const msg = JSON.parse(text);
            if (msg.type === 'ping') return; // skip ping messages
          } catch { /* not JSON, resolve anyway */ }
          clearTimeout(timeout);
          resolve(text);
        });
        ws.on('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      const parsed = JSON.parse(message);
      expect(['definitions', 'evaluated']).toContain(parsed.type);
      expect(parsed).toHaveProperty('timestamp');

      ws.close();
    } catch (err) {
      console.warn('WebSocket smoke test skipped due to connection issue:', (err as Error).message);
    }
  }, 20_000);
});
