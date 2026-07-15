import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { LoadContext } from '@docusaurus/types';
import { resolveContentRoots, discoverContentRootsFromConfig } from './index';

// resolveContentRoots and discoverContentRootsFromConfig are pure functions
// over LoadContext-shaped input, so the tests build a minimal LoadContext
// and a temp filesystem rather than booting Docusaurus.

function makeContext(siteDir: string, plugins: unknown[] = [], baseUrl = '/'): LoadContext {
  return {
    siteDir,
    siteConfig: {
      plugins,
    } as unknown as LoadContext['siteConfig'],
    baseUrl,
  } as unknown as LoadContext;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toggly-plugin-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, contents: string): void {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, 'utf-8');
}

function frontmatter(featureKey: string, body = '# Title\n'): string {
  return `---\nx-feature: ${featureKey}\n---\n\n${body}`;
}

describe('discoverContentRootsFromConfig', () => {
  it('returns empty array when no plugin-content-docs entries are configured', () => {
    const ctx = makeContext(tmpDir, [
      ['@ops-ai/toggly-docusaurus-plugin', {}],
      ['some-other-plugin', { path: 'whatever' }],
    ]);
    expect(discoverContentRootsFromConfig(ctx)).toEqual([]);
  });

  it('extracts path/routeBasePath from plugin-content-docs instances', () => {
    const ctx = makeContext(tmpDir, [
      ['@docusaurus/plugin-content-docs', { id: 'sdks', path: 'sdks', routeBasePath: 'sdks' }],
      ['@docusaurus/plugin-content-docs', { id: 'guides', path: 'guides', routeBasePath: 'guides' }],
    ]);
    expect(discoverContentRootsFromConfig(ctx)).toEqual([
      { path: 'sdks', routeBasePath: 'sdks' },
      { path: 'guides', routeBasePath: 'guides' },
    ]);
  });

  it('falls back to "docs" when path or routeBasePath are missing', () => {
    const ctx = makeContext(tmpDir, [
      ['@docusaurus/plugin-content-docs', {}],
    ]);
    expect(discoverContentRootsFromConfig(ctx)).toEqual([
      { path: 'docs', routeBasePath: 'docs' },
    ]);
  });

  it('ignores string-only plugin entries that cannot be introspected', () => {
    const ctx = makeContext(tmpDir, [
      '@docusaurus/plugin-content-docs',
      ['@docusaurus/plugin-content-docs', { path: 'sdks', routeBasePath: 'sdks' }],
    ]);
    expect(discoverContentRootsFromConfig(ctx)).toEqual([
      { path: 'sdks', routeBasePath: 'sdks' },
    ]);
  });
});

describe('resolveContentRoots', () => {
  it('always includes the classic preset docs root by default', () => {
    const ctx = makeContext(tmpDir, []);
    const roots = resolveContentRoots(ctx);
    expect(roots).toEqual([{ path: 'docs', routeBasePath: 'docs' }]);
  });

  it('merges discovered roots with the docs default and de-duplicates', () => {
    const ctx = makeContext(tmpDir, [
      ['@docusaurus/plugin-content-docs', { path: 'docs', routeBasePath: 'docs' }],
      ['@docusaurus/plugin-content-docs', { path: 'sdks', routeBasePath: 'sdks' }],
    ]);
    const roots = resolveContentRoots(ctx);
    expect(roots).toEqual([
      { path: 'docs', routeBasePath: 'docs' },
      { path: 'sdks', routeBasePath: 'sdks' },
    ]);
  });

  it('respects an explicit override and skips auto-detection', () => {
    const ctx = makeContext(tmpDir, [
      ['@docusaurus/plugin-content-docs', { path: 'sdks', routeBasePath: 'sdks' }],
    ]);
    const roots = resolveContentRoots(ctx, [
      { path: 'manual', routeBasePath: '/custom/' },
    ]);
    expect(roots).toEqual([{ path: 'manual', routeBasePath: 'custom' }]);
  });

  it('normalizes leading/trailing slashes', () => {
    const ctx = makeContext(tmpDir, []);
    const roots = resolveContentRoots(ctx, [
      { path: '/sdks/', routeBasePath: '/sdks/' },
    ]);
    expect(roots).toEqual([{ path: 'sdks', routeBasePath: 'sdks' }]);
  });
});

// ---------------------------------------------------------------------------
// extractFromFiles is internal but exercised through the public plugin via
// integration. To verify behavior directly we re-import it via dynamic require
// so we don't need to expand the public API.
// ---------------------------------------------------------------------------

import * as pluginModule from './index';

// Cast to access non-exported helper for tests by re-loading the compiled file.
// We rely on the production export `resolveContentRoots` + filesystem to assert routes.
// To avoid leaking internals we run extraction by invoking the plugin's contentLoaded
// indirectly via a small re-implementation: replicate by running glob+frontmatter parse.
// However, the simplest path is to drive contentLoaded through the plugin factory.

import togglyPlugin from './index';

describe('togglyPlugin contentLoaded -> page feature mapping (integration)', () => {
  it('maps docs/ files to /docs/<route>', async () => {
    writeFile('docs/intro.mdx', frontmatter('Features'));
    writeFile('docs/01-overview/index.mdx', frontmatter('Overview'));
    writeFile('docs/01-overview/getting-started.mdx', frontmatter('Onboarding'));

    const mapping = await runPluginExtraction(tmpDir, []);
    expect(mapping).toEqual({
      '/docs/intro': 'Features',
      '/docs/overview': 'Overview',
      '/docs/overview/getting-started': 'Onboarding',
    });
  });

  it('maps sdks/ files to /sdks/<route> when plugin-content-docs is registered', async () => {
    writeFile('docs/.keep.md', '');
    writeFile('sdks/go/index.mdx', frontmatter('GoSdk'));
    writeFile('sdks/go/configuration.mdx', frontmatter('GoSdk'));
    writeFile('sdks/php/laravel.mdx', frontmatter('PhpSdk'));

    const plugins = [
      ['@docusaurus/plugin-content-docs', { id: 'sdks', path: 'sdks', routeBasePath: 'sdks' }],
    ];

    const mapping = await runPluginExtraction(tmpDir, plugins);
    expect(mapping).toMatchObject({
      '/sdks/go': 'GoSdk',
      '/sdks/go/configuration': 'GoSdk',
      '/sdks/php/laravel': 'PhpSdk',
    });
    // Should NOT mistakenly emit /docs/sdks/...
    for (const key of Object.keys(mapping)) {
      expect(key.startsWith('/docs/sdks')).toBe(false);
    }
  });

  it('uses the configured routeBasePath even when it differs from the directory name', async () => {
    writeFile('content/article.mdx', frontmatter('Articles'));
    const plugins = [
      ['@docusaurus/plugin-content-docs', { path: 'content', routeBasePath: 'kb' }],
    ];

    const mapping = await runPluginExtraction(tmpDir, plugins);
    expect(mapping).toEqual({ '/kb/article': 'Articles' });
  });

  it('honors explicit contentRoots option and skips auto-detection', async () => {
    writeFile('docs/auto.mdx', frontmatter('Auto'));
    writeFile('manual/page.mdx', frontmatter('Manual'));

    const plugins = [
      ['@docusaurus/plugin-content-docs', { path: 'docs', routeBasePath: 'docs' }],
    ];

    const mapping = await runPluginExtraction(tmpDir, plugins, {
      contentRoots: [{ path: 'manual', routeBasePath: 'manual' }],
    });

    expect(mapping).toEqual({ '/manual/page': 'Manual' });
  });

  it('handles index files at the root of a content directory', async () => {
    writeFile('sdks/index.mdx', frontmatter('Sdks'));

    const plugins = [
      ['@docusaurus/plugin-content-docs', { path: 'sdks', routeBasePath: 'sdks' }],
    ];

    const mapping = await runPluginExtraction(tmpDir, plugins);
    expect(mapping).toEqual({ '/sdks': 'Sdks' });
  });

  it('strips numeric order prefixes from path segments', async () => {
    writeFile('docs/02-using-toggly/01-intro.mdx', frontmatter('Intro'));

    const mapping = await runPluginExtraction(tmpDir, []);
    expect(mapping).toEqual({ '/docs/using-toggly/intro': 'Intro' });
  });

  it('prepends baseUrl when set to a subpath', async () => {
    writeFile('docs/intro.mdx', frontmatter('Features'));
    const mapping = await runPluginExtraction(tmpDir, [], {}, '/project-name/');
    expect(mapping).toEqual({ '/project-name/docs/intro': 'Features' });
  });

  it('skips files without x-feature frontmatter', async () => {
    writeFile('docs/intro.mdx', '---\ntitle: Intro\n---\n\n# Intro\n');
    writeFile('docs/feature.mdx', frontmatter('Features'));

    const mapping = await runPluginExtraction(tmpDir, []);
    expect(mapping).toEqual({ '/docs/feature': 'Features' });
  });
});

describe('togglyPlugin injectHtmlTags script escaping', () => {
  it('escapes </script sequences in injected config and page feature scripts', async () => {
    writeFile('docs/intro.mdx', frontmatter('Features'));

    const context = makeContext(tmpDir, []);
    const plugin = togglyPlugin(context, {
      appKey: 'key</script><script>alert(1)',
      identity: 'user</script><script>alert(1)',
      staticGating: false,
    });

    const content = await (plugin.loadContent as () => Promise<unknown>)();
    const thisRef: {
      __togglyPluginData?: {
        config: unknown;
        pageFeatureMapping: Record<string, string>;
        buildTimeFlags: Record<string, boolean>;
      };
    } = {};
    await (plugin.contentLoaded as (args: { content: unknown; actions: unknown }) => Promise<void>).call(
      thisRef,
      { content, actions: {} as never },
    );

    expect(thisRef.__togglyPluginData).toBeDefined();

    const tags = (
      plugin.injectHtmlTags as (this: typeof thisRef) => {
        headTags?: { tagName: string; innerHTML: string }[];
      }
    ).call(thisRef);

    const scripts = (tags.headTags ?? [])
      .filter((t) => t.tagName === 'script')
      .map((t) => t.innerHTML);

    expect(scripts.length).toBe(2);

    const configScript = scripts.find((s) => s.includes('__TOGGLY_CONFIG__'));
    expect(configScript).toBeDefined();
    expect(configScript).not.toMatch(/<\/script/i);
    expect(configScript).toContain('<\\/script');

    for (const html of scripts) {
      expect(html).not.toMatch(/<\/script/i);
    }
  });
});

/**
 * Drive togglyPlugin.contentLoaded with a minimal LoadContext + actions and
 * return whatever the plugin would inject as `__TOGGLY_PAGE_FEATURES__`.
 */
async function runPluginExtraction(
  siteDir: string,
  plugins: unknown[],
  options: Parameters<typeof togglyPlugin>[1] = {},
  baseUrl = '/',
): Promise<Record<string, string>> {
  const context = makeContext(siteDir, plugins, baseUrl);
  const plugin = togglyPlugin(context, options);

  // Mirror what Docusaurus does: invoke loadContent then contentLoaded.
  const content = await (plugin.loadContent as () => Promise<unknown>)();
  const thisRef: { __togglyPluginData?: { pageFeatureMapping: Record<string, string> } } = {};
  await (plugin.contentLoaded as (args: { content: unknown; actions: unknown }) => Promise<void>).call(
    thisRef,
    { content, actions: {} as never },
  );

  return thisRef.__togglyPluginData?.pageFeatureMapping ?? {};
}

// pluginModule is imported only to keep typescript happy when we ref it; ensures the
// resolveContentRoots/discoverContentRootsFromConfig public re-exports stay live.
void pluginModule;
