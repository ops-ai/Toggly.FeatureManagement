import WebSocket from 'ws';

describe('WebSocket smoke test', () => {
  let appKey: string;

  beforeAll(() => {
    appKey = (globalThis as any).__karma__?.config?.smokeAppKey || '';
  });

  it('connects and receives initial definitions message', async () => {
    if (!appKey) {
      pending('TOGGLY_SMOKE_APP_KEY_FRONTEND not configured');
      return;
    }

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
          if (msg.type === 'ping') return;
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
    expect(parsed.timestamp).toBeDefined();

    ws.close();
  }, 20_000);
});
