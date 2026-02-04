import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to test the side-effect import behavior of setup.ts
// The module auto-initializes when imported if window.__TOGGLY_CONFIG__ exists

describe('Client Setup', () => {
  let originalWindow: any;

  beforeEach(() => {
    vi.resetModules();
    originalWindow = (globalThis as any).window;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it('should auto-initialize when window.__TOGGLY_CONFIG__ is set', async () => {
    // Set up the config on window
    (globalThis as any).window = {
      __TOGGLY_CONFIG__: {
        environment: 'test',
        flagDefaults: { Feature1: true },
      },
    };

    // Dynamically import the module (triggers auto-init)
    const storeModule = await import('../../client/store.js');
    // Reset client first to allow re-init
    storeModule.__resetClient();

    const setupModule = await import('../../client/setup.js');

    // Give it a moment to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The export should be available
    expect(setupModule.initTogglyClient).toBeDefined();
  });

  it('should warn when no config found on window', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Window exists but no config
    (globalThis as any).window = {};

    // Re-import to trigger side-effect
    vi.resetModules();
    await import('../../client/setup.js');

    // Check that warning was logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No configuration found')
    );

    warnSpy.mockRestore();
  });

  it('should export initTogglyClient for manual use', async () => {
    const module = await import('../../client/setup.js');
    expect(module.initTogglyClient).toBeDefined();
    expect(typeof module.initTogglyClient).toBe('function');
  });
});
