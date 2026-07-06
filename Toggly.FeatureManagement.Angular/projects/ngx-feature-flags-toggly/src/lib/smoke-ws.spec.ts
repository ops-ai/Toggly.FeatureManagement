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

      ws.onmessage = (event: MessageEvent) => {
        const text = typeof event.data === 'string' ? event.data : '';
        try {
          const msg = JSON.parse(text);
          if (msg.type === 'ping') return;
        } catch { /* not JSON, resolve anyway */ }
        clearTimeout(timeout);
        resolve(text);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      };
    });

    const parsed = JSON.parse(message);
    expect(['sync', 'definitions', 'evaluated']).toContain(parsed.type);
    if (parsed.type === 'sync') {
      expect(parsed.etag).toBeDefined();
      expect(parsed.lastUpdated).toBeDefined();
    } else {
      expect(parsed.timestamp).toBeDefined();
    }

    ws.close();
  }, 20_000);
});
