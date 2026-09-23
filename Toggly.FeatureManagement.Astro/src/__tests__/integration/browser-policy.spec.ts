import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTogglyServerClient } from '../../server/toggly-server.js';
import togglyIntegration from '../../integration/index.js';

vi.mock('../../server/toggly-server.js', () => ({ createTogglyServerClient: vi.fn(() => ({})) }));
vi.mock('glob', () => ({ glob: vi.fn().mockResolvedValue([]) }));
vi.mock('fs', () => ({ existsSync: vi.fn().mockReturnValue(false) }));

describe('integration browser category policy', () => {
  beforeEach(() => vi.clearAllMocks());
  for (const shared of [undefined, false, true]) {
    for (const browser of [undefined, false, true]) {
      it(`inherits ${shared} or explicitly overrides with ${browser} without changing server owners`, async () => {
        const plugin = togglyIntegration({
          appKey: 'test-key', allFeaturesEnabledDuringBuild: true,
          enableTelemetry: false,
          enableUsageTracking: shared, enableMetrics: shared,
          browserEnableUsageTracking: browser, browserEnableMetrics: browser,
        });
        const injectScript = vi.fn();
        await (plugin.hooks['astro:config:setup'] as any)({
          config: { srcDir: { pathname: '/fixture/' } }, injectScript, updateConfig: vi.fn(),
        });
        const script = injectScript.mock.calls[0][1];
        const client = JSON.parse(script.match(/window.__TOGGLY_CONFIG__ = (.*);/)[1]);
        expect(client.enableUsageTracking).toBe(browser ?? shared);
        expect(client.enableMetrics).toBe(browser ?? shared);
        expect(client.enableTelemetry).toBe(false);
        expect(client.allFeaturesEnabledDuringBuild).toBe(false);
        expect(client).not.toHaveProperty('browserEnableUsageTracking');
        expect(client).not.toHaveProperty('browserEnableMetrics');
        await (plugin.hooks['astro:server:setup'] as any)({ server: { middlewares: { use: vi.fn() } } });
        await (plugin.hooks['astro:build:start'] as any)();
        expect(createTogglyServerClient).toHaveBeenCalledTimes(2);
        expect(vi.mocked(createTogglyServerClient).mock.calls.map(call => call[1])).toEqual([false, true]);
        for (const [server] of vi.mocked(createTogglyServerClient).mock.calls) {
          expect(server.enableUsageTracking).toBe(shared);
          expect(server.enableMetrics).toBe(shared);
          expect(server).not.toHaveProperty('browserEnableUsageTracking');
          expect(server).not.toHaveProperty('browserEnableMetrics');
        }
      });
    }
  }
  it('overrides the two browser categories independently', async () => {
    const plugin = togglyIntegration({ enableUsageTracking: false, enableMetrics: true,
      browserEnableUsageTracking: true, browserEnableMetrics: false });
    const injectScript = vi.fn();
    await (plugin.hooks['astro:config:setup'] as any)({ config: {}, injectScript, updateConfig: vi.fn() });
    const client = JSON.parse(injectScript.mock.calls[0][1].match(/window.__TOGGLY_CONFIG__ = (.*);/)[1]);
    expect(client.enableUsageTracking).toBe(true);
    expect(client.enableMetrics).toBe(false);
  });
});
