import { afterEach, beforeEach, vi } from 'vitest';
beforeEach(() => {
  if (typeof window === 'undefined') return;
  vi.stubGlobal('fetch', async (input: unknown) => {
    if (String(input).includes('/api/frontend/telemetry'))
      return new Response(null, { status: 202 });
    throw new Error('Unexpected unit-test network request');
  });
});
afterEach(() => {
  if (typeof window !== 'undefined') vi.unstubAllGlobals();
});
