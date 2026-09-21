import { afterEach, beforeEach, vi } from 'vitest';

// Unit tests use fake application keys. Never send their teardown telemetry.
beforeEach(() => {
  vi.stubGlobal('fetch', async (input: unknown) => {
    if (String(input).includes('/api/frontend/telemetry'))
      return new Response(null, { status: 202 });
    throw new Error('Unexpected unit-test network request');
  });
});
afterEach(() => vi.unstubAllGlobals());
