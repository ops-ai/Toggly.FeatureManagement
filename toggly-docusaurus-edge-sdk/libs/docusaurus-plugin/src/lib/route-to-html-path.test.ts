import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { routeToHtmlPath } from './route-to-html-path';

describe('routeToHtmlPath', () => {
  it('maps the site root and nested routes to their built HTML artifacts', () => {
    const outDir = path.join(path.sep, 'tmp', 'docusaurus-build');

    expect(routeToHtmlPath(outDir, '/')).toBe(path.join(outDir, 'index.html'));
    expect(routeToHtmlPath(outDir, '/guides/intro/')).toBe(
      path.join(outDir, 'guides', 'intro', 'index.html')
    );
  });
});
