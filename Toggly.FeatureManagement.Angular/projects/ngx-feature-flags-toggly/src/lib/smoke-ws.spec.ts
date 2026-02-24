describe('WebSocket smoke test', () => {
  it('connects and receives initial message', (done) => {
    const appKey = (globalThis as any).process?.env?.TOGGLY_SMOKE_APP_KEY_FRONTEND;
    if (!appKey) {
      done();
      return;
    }

    const ws = new WebSocket(`wss://definitions.toggly.io/${appKey}/ws`);
    const timeout = setTimeout(() => {
      ws.close();
      done.fail('WebSocket timed out after 10 seconds');
    }, 15_000);

    ws.onmessage = (event: MessageEvent) => {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'ping') return; // skip ping messages
      clearTimeout(timeout);
      expect(['definitions', 'evaluated']).toContain(parsed.type);
      expect(parsed.timestamp).toBeDefined();
      ws.close();
      done();
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      done.fail('WebSocket connection error');
    };
  }, 20_000);
});
