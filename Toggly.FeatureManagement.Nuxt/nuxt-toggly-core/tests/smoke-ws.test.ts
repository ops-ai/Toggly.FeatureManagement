/**
 * @vitest-environment node
 *
 * Nuxt core uses browser-native WebSocket (guarded by typeof window),
 * so in Node we verify the WS endpoint directly using the `ws` package.
 */
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';

const appKey = process.env.TOGGLY_SMOKE_APP_KEY_FRONTEND;

describe('WebSocket smoke test', () => {
  it('connects and receives initial definitions message', async () => {
    if (!appKey) throw new Error('TOGGLY_SMOKE_APP_KEY_FRONTEND is not configured — set this env var to run smoke tests');
    const ws = new WebSocket(`wss://definitions.toggly.io/${appKey!}/ws`);

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
    expect(parsed).toHaveProperty('timestamp');

    ws.close();
  }, 20_000);
});
