import { describe, it, expect, afterEach } from 'vitest';
import {
  buildDefinitionFetchHeaders,
  sdkUserAgent,
  usesSdkCustomHeaders,
  SDK_ID,
  SDK_VERSION,
} from '../sdk-identity.js';

describe('sdk-identity', () => {
  afterEach(() => {
    // jsdom restores window/document between tests; no cleanup needed
  });

  it('builds user agent and custom headers helpers', () => {
    expect(sdkUserAgent()).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
    expect(usesSdkCustomHeaders()).toBe(true);
  });

  it('uses custom headers in browser-like environments', () => {
    const headers = buildDefinitionFetchHeaders({ Accept: 'application/json' });
    expect(headers['X-Toggly-Sdk']).toBe(SDK_ID);
    expect(headers['X-Toggly-Sdk-Version']).toBe(SDK_VERSION);
    expect(headers['User-Agent']).toBeUndefined();
  });

  it('uses User-Agent when custom headers are not applicable', () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDocument = (globalThis as { document?: unknown }).document;
    // Simulate non-browser by removing window/document
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).document;

    try {
      expect(usesSdkCustomHeaders()).toBe(false);
      const headers = buildDefinitionFetchHeaders({});
      expect(headers['User-Agent']).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  });
});
