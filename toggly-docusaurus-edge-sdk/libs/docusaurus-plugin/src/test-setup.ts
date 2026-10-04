import { afterEach, beforeEach, vi } from 'vitest';
beforeEach(() => {
  if (typeof window === 'undefined') return;
  vi.stubGlobal('fetch', (input: unknown) => {
    if (String(input).includes('/api/frontend/telemetry'))
      return Promise.resolve(new Response(null, { status: 202 }));
    return Promise.reject(new Error('Unexpected unit-test network request'));
  });
});
afterEach(() => {
  if (typeof window !== 'undefined') vi.unstubAllGlobals();
});
