import { describe, expect, it } from 'vitest';
import {
  shouldStripFeatureElement,
  transformHtmlResponse,
} from '../../src/html-rewriter';

describe('HTMLRewriter feature gating (workerd)', () => {
  it('exposes shouldStripFeatureElement decisions used by the transformer', () => {
    expect(shouldStripFeatureElement({ FeatureOn: true }, 'FeatureOn', null)).toBe(
      false,
    );
    expect(shouldStripFeatureElement({ FeatureOff: false }, 'FeatureOff', null)).toBe(
      true,
    );
    expect(
      shouldStripFeatureElement({ FeatureOff: false }, 'FeatureOff', 'true'),
    ).toBe(false);
    expect(shouldStripFeatureElement({}, null, null)).toBe(false);
  });

  it('strips disabled [data-feature] nodes and keeps negate wrappers', async () => {
    const html = `<!doctype html><html><head><title>docs</title></head><body>
<section data-feature="FeatureOn">ENABLED_SECTION</section>
<section data-feature="FeatureOff">DISABLED_SECTION</section>
<section data-feature="FeatureOff" data-toggly-negate="true">NEGATED_SECTION</section>
</body></html>`;

    const transformed = transformHtmlResponse(
      new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      { FeatureOn: true, FeatureOff: false },
    );

    expect(transformed.headers.get('content-length')).toBeNull();
    const body = await transformed.text();
    expect(body).toContain('ENABLED_SECTION');
    expect(body).not.toContain('DISABLED_SECTION');
    expect(body).toContain('NEGATED_SECTION');
    expect(body).toContain('window.__TOGGLY_EDGE_FLAGS__');
    expect(body).toMatch(
      /<script>window\.__TOGGLY_EDGE_FLAGS__=\{"FeatureOn":true,"FeatureOff":false\};<\/script>/,
    );
  });

  it('escapes </script sequences inside the injected flag snapshot', async () => {
    const weirdKey = 'evil</script><script>alert(1)';
    const html =
      '<html><head></head><body><div data-feature="safe">SAFE</div></body></html>';
    const transformed = transformHtmlResponse(
      new Response(html, { headers: { 'content-type': 'text/html' } }),
      { [weirdKey]: true, safe: true },
    );
    const body = await transformed.text();
    expect(body).toContain('<\\/script');
    expect(body).not.toMatch(/window\.__TOGGLY_EDGE_FLAGS__=.*<\/script><script>/i);
    expect(body).toContain('SAFE');
  });

  it('invokes the optional feature-gate observer without breaking the stream', async () => {
    const seen: Array<{ key: string; enabled: boolean }> = [];
    const html =
      '<html><head></head><body><div data-feature="A">A</div><div data-feature="B">B</div></body></html>';
    const transformed = transformHtmlResponse(
      new Response(html, { headers: { 'content-type': 'text/html' } }),
      { A: true, B: false },
      (key, enabled) => {
        seen.push({ key, enabled });
      },
    );
    const body = await transformed.text();
    expect(body).toContain('>A<');
    expect(body).not.toContain('>B<');
    expect(seen).toEqual([
      { key: 'A', enabled: true },
      { key: 'B', enabled: false },
    ]);
  });

  it('returns the original response when the body is null', () => {
    const empty = new Response(null, { status: 204 });
    const result = transformHtmlResponse(empty, { FeatureOn: true });
    expect(result).toBe(empty);
  });
});
