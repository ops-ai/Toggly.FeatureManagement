import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs and glob before importing
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

import { glob } from 'glob';
import togglyIntegration, { createTogglyMiddleware } from '../../integration/index.js';

describe('Toggly Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('togglyIntegration', () => {
    it('should return a valid AstroIntegration object', () => {
      const integration = togglyIntegration();

      expect(integration.name).toBe('@ops-ai/astro-feature-flags-toggly');
      expect(integration.hooks).toBeDefined();
    });

    it('should have required lifecycle hooks', () => {
      const integration = togglyIntegration();

      expect(integration.hooks['astro:config:setup']).toBeDefined();
      expect(integration.hooks['astro:server:setup']).toBeDefined();
      expect(integration.hooks['astro:build:start']).toBeDefined();
      expect(integration.hooks['astro:build:done']).toBeDefined();
      expect(integration.hooks['astro:config:done']).toBeDefined();
    });

    it('should apply default config when no options given', () => {
      const integration = togglyIntegration();
      // Integration created without errors
      expect(integration).toBeDefined();
    });

    it('should merge user options with defaults', () => {
      const integration = togglyIntegration({
        appKey: 'test-key',
        environment: 'Staging',
        isDebug: true,
      });
      expect(integration).toBeDefined();
    });
  });

  describe('astro:config:setup', () => {
    it('should inject client setup script', async () => {
      const integration = togglyIntegration({
        appKey: 'test-key',
        environment: 'Production',
      });

      const injectScript = vi.fn();
      const updateConfig = vi.fn();
      const mockConfig = { srcDir: { pathname: '/tmp/src/' } };

      await (integration.hooks['astro:config:setup'] as any)({
        config: mockConfig,
        injectScript,
        updateConfig,
      });

      expect(injectScript).toHaveBeenCalledWith('page', expect.stringContaining('__TOGGLY_CONFIG__'));
    });

    it('should set allFeaturesEnabledDuringBuild to false in client config', async () => {
      const integration = togglyIntegration({
        appKey: 'test-key',
        allFeaturesEnabledDuringBuild: true,
      });

      const injectScript = vi.fn();
      const updateConfig = vi.fn();

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript,
        updateConfig,
      });

      // Client-side config should have allFeaturesEnabledDuringBuild: false
      const scriptArg = injectScript.mock.calls[0][1];
      expect(scriptArg).toContain('"allFeaturesEnabledDuringBuild":false');
    });

    it('should add Vite plugin for x-feature transform', async () => {
      const integration = togglyIntegration();
      const updateConfig = vi.fn();

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig,
      });

      expect(updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          vite: expect.objectContaining({
            plugins: expect.arrayContaining([
              expect.objectContaining({
                name: 'toggly-x-feature-transform',
                enforce: 'pre',
              }),
            ]),
          }),
        })
      );
    });

    it('should configure SSR noExternal', async () => {
      const integration = togglyIntegration();
      const updateConfig = vi.fn();

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig,
      });

      const viteConfig = updateConfig.mock.calls[0][0].vite;
      expect(viteConfig.ssr.noExternal).toContain(
        '@ops-ai/astro-feature-flags-toggly'
      );
    });
  });

  describe('x-feature Vite plugin', () => {
    it('should strip x-feature from .astro file frontmatter', async () => {
      const integration = togglyIntegration();
      const updateConfig = vi.fn();

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig,
      });

      const plugin = updateConfig.mock.calls[0][0].vite.plugins[0];

      // Simulate loading an .astro file with x-feature
      const mockContent = `---
title: "My Page"
x-feature: MyFeature
layout: ../layouts/Main.astro
---
<h1>Hello</h1>`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      const result = plugin.load('/path/to/page.astro');
      expect(result).toBeDefined();
      expect(result).not.toContain('x-feature:');
      expect(result).toContain('title: "My Page"');
      expect(result).toContain('<h1>Hello</h1>');
    });

    it('should ignore non-.astro files', async () => {
      const integration = togglyIntegration();
      const updateConfig = vi.fn();

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig,
      });

      const plugin = updateConfig.mock.calls[0][0].vite.plugins[0];
      const result = plugin.load('/path/to/file.ts');
      expect(result).toBeNull();
    });

    it('should ignore .astro files without frontmatter', async () => {
      const integration = togglyIntegration();
      const updateConfig = vi.fn();

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig,
      });

      const plugin = updateConfig.mock.calls[0][0].vite.plugins[0];
      vi.mocked(fs.readFileSync).mockReturnValue('<h1>No frontmatter</h1>');

      const result = plugin.load('/path/to/page.astro');
      expect(result).toBeNull();
    });

    it('should ignore .astro files without x-feature in frontmatter', async () => {
      const integration = togglyIntegration();
      const updateConfig = vi.fn();

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig,
      });

      const plugin = updateConfig.mock.calls[0][0].vite.plugins[0];

      vi.mocked(fs.readFileSync).mockReturnValue(`---
title: "My Page"
layout: ../layouts/Main.astro
---
<h1>Hello</h1>`);

      const result = plugin.load('/path/to/page.astro');
      expect(result).toBeNull();
    });
  });

  describe('astro:config:done', () => {
    it('should store final config', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const mockConfig = { base: '/', srcDir: { pathname: '/tmp/src/' } };

      (integration.hooks['astro:config:done'] as any)({
        config: mockConfig,
        setAdapter: vi.fn(),
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Toggly Integration] Configuration finalized'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('astro:build:done', () => {
    it('should write manifest JSON', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // First setup config
      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      // Then run build:done
      await (integration.hooks['astro:build:done'] as any)({
        dir: { pathname: '/tmp/dist/' },
      });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('toggly-page-features.json'),
        expect.any(String),
        'utf-8'
      );

      consoleSpy.mockRestore();
    });

    it('should write config JSON without exposing appKey', async () => {
      const integration = togglyIntegration({
        appKey: 'secret-key',
        isDebug: true,
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      await (integration.hooks['astro:build:done'] as any)({
        dir: { pathname: '/tmp/dist/' },
      });

      // Find the config write call
      const configWriteCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        (call) => (call[0] as string).includes('toggly-config.json')
      );
      expect(configWriteCall).toBeDefined();

      const writtenConfig = JSON.parse(configWriteCall![1] as string);
      expect(writtenConfig.appKey).toBe('***');

      consoleSpy.mockRestore();
    });
  });

  describe('astro:server:setup', () => {
    it('should add middleware that attaches togglyClient to request', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // First, config:setup must run to set astroConfig
      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' } },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      const useFn = vi.fn();
      const mockServer = { middlewares: { use: useFn } };

      await (integration.hooks['astro:server:setup'] as any)({
        server: mockServer,
      });

      expect(useFn).toHaveBeenCalledWith(expect.any(Function));

      // Test the middleware function
      const middleware = useFn.mock.calls[0][0];
      const req: any = {};
      const res: any = {};
      const next = vi.fn();

      middleware(req, res, next);

      expect(req.togglyClient).toBeDefined();
      expect(next).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('astro:build:start', () => {
    it('should extract page features from frontmatter', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Setup config first
      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      // Store final config
      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        setAdapter: vi.fn(),
      });

      // Mock existsSync for pages/content dirs
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return p.toString().includes('pages');
      });

      // Mock glob to return some files
      vi.mocked(glob).mockResolvedValue(['about.astro', 'pricing.md']);

      // Mock readFileSync for the files
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        const filePath = p.toString();
        if (filePath.includes('about.astro')) {
          return `---
title: "About"
x-feature: AboutPage
---
<h1>About</h1>`;
        }
        if (filePath.includes('pricing.md')) {
          return `---
title: "Pricing"
x-feature: PricingPage
---
# Pricing`;
        }
        return '';
      });

      await (integration.hooks['astro:build:start'] as any)();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found')
      );

      consoleSpy.mockRestore();
    });

    it('should create build-time client when allFeaturesEnabledDuringBuild is true', async () => {
      const integration = togglyIntegration({
        isDebug: true,
        allFeaturesEnabledDuringBuild: true,
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        setAdapter: vi.fn(),
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await (integration.hooks['astro:build:start'] as any)();

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Toggly Integration] Build mode: All features will be enabled'
      );

      consoleSpy.mockRestore();
    });

    it('should handle no pages or content directories', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        setAdapter: vi.fn(),
      });

      vi.mocked(fs.existsSync).mockReturnValue(false);

      await (integration.hooks['astro:build:start'] as any)();

      // Should find 0 pages with x-feature
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 0 pages')
      );

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should handle files without frontmatter', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        setAdapter: vi.fn(),
      });

      vi.mocked(fs.existsSync).mockImplementation((p: any) =>
        p.toString().includes('pages')
      );
      vi.mocked(glob).mockResolvedValue(['no-frontmatter.astro']);
      vi.mocked(fs.readFileSync).mockReturnValue('<h1>No frontmatter</h1>');

      await (integration.hooks['astro:build:start'] as any)();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 0 pages')
      );

      consoleSpy.mockRestore();
    });

    it('should handle files with frontmatter but no x-feature', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        setAdapter: vi.fn(),
      });

      vi.mocked(fs.existsSync).mockImplementation((p: any) =>
        p.toString().includes('pages')
      );
      vi.mocked(glob).mockResolvedValue(['normal.astro']);
      vi.mocked(fs.readFileSync).mockReturnValue(`---
title: "Normal Page"
---
<h1>Hello</h1>`);

      await (integration.hooks['astro:build:start'] as any)();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 0 pages')
      );

      consoleSpy.mockRestore();
    });

    it('should strip quotes from x-feature values', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        setAdapter: vi.fn(),
      });

      vi.mocked(fs.existsSync).mockImplementation((p: any) =>
        p.toString().includes('pages')
      );
      vi.mocked(glob).mockResolvedValue(['quoted.astro']);
      vi.mocked(fs.readFileSync).mockReturnValue(`---
x-feature: "QuotedFeature"
---
<h1>Quoted</h1>`);

      await (integration.hooks['astro:build:start'] as any)();

      // Should log the route with the feature (unquoted)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('QuotedFeature')
      );

      consoleSpy.mockRestore();
    });

    it('should convert file paths to routes correctly', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        setAdapter: vi.fn(),
      });

      vi.mocked(fs.existsSync).mockImplementation((p: any) =>
        p.toString().includes('pages')
      );
      vi.mocked(glob).mockResolvedValue([
        'index.astro',
        'about.astro',
        'blog/index.astro',
        'blog/01-first-post.md',
      ]);
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        return `---
x-feature: TestFeature
---
<h1>Content</h1>`;
      });

      await (integration.hooks['astro:build:start'] as any)();

      // Should find 4 pages
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 4 pages')
      );

      // Check the found count
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 4 pages')
      );

      // Verify the route logs contain expected routes
      // The format is "  /route -> TestFeature" logged via console.log
      expect(consoleSpy).toHaveBeenCalledWith('  /about -> TestFeature');
      expect(consoleSpy).toHaveBeenCalledWith('  /blog -> TestFeature');
      expect(consoleSpy).toHaveBeenCalledWith('  /blog/first-post -> TestFeature');

      consoleSpy.mockRestore();
    });

    it('should prepend base path when configured', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/docs' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/docs' },
        setAdapter: vi.fn(),
      });

      vi.mocked(fs.existsSync).mockImplementation((p: any) =>
        p.toString().includes('pages')
      );
      vi.mocked(glob).mockResolvedValue(['about.astro']);
      vi.mocked(fs.readFileSync).mockReturnValue(`---
x-feature: AboutFeature
---
<h1>About</h1>`);

      await (integration.hooks['astro:build:start'] as any)();

      const logCalls = consoleSpy.mock.calls.map(c => c.join(' '));
      expect(logCalls.some(c => c.includes('/docs/about'))).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should scan content directory when it exists', async () => {
      const integration = togglyIntegration({ isDebug: true });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await (integration.hooks['astro:config:setup'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        injectScript: vi.fn(),
        updateConfig: vi.fn(),
      });

      (integration.hooks['astro:config:done'] as any)({
        config: { srcDir: { pathname: '/tmp/src/' }, base: '/' },
        setAdapter: vi.fn(),
      });

      // Both pages and content exist
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(glob).mockResolvedValue([]);

      await (integration.hooks['astro:build:start'] as any)();

      // glob should be called twice (once for pages, once for content)
      expect(glob).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });

  describe('createTogglyMiddleware', () => {
    it('should return an async middleware function', () => {
      const middleware = createTogglyMiddleware({
        environment: 'test',
        flagDefaults: { F1: true },
      });

      expect(typeof middleware).toBe('function');
    });

    it('should create toggly client on locals', async () => {
      const middleware = createTogglyMiddleware({
        environment: 'test',
        flagDefaults: { Feature1: true },
      });

      const locals: Record<string, any> = {};
      const next = vi.fn().mockResolvedValue(new Response('OK'));

      await middleware({ locals }, next);

      expect(locals.toggly).toBeDefined();
      expect(next).toHaveBeenCalled();
    });

    it('should not re-create client if already on locals', async () => {
      const middleware = createTogglyMiddleware({
        environment: 'test',
        flagDefaults: { F1: true },
      });

      const existingClient = { existing: true };
      const locals: Record<string, any> = { toggly: existingClient };
      const next = vi.fn().mockResolvedValue(new Response('OK'));

      await middleware({ locals }, next);

      // Should keep existing client
      expect(locals.toggly).toBe(existingClient);
    });

    it('should call next() and return its response', async () => {
      const middleware = createTogglyMiddleware({
        environment: 'test',
      });

      const mockResponse = new Response('Hello');
      const next = vi.fn().mockResolvedValue(mockResponse);

      const result = await middleware({ locals: {} }, next);

      expect(next).toHaveBeenCalled();
      expect(result).toBe(mockResponse);
    });
  });
});
