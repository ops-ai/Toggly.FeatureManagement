import * as path from 'path';

/**
 * Map a Docusaurus route (e.g. `/sdks/java`) to a built HTML file path
 * under the output directory.
 */
export function routeToHtmlPath(outDir: string, route: string): string {
  const normalized = route === '/' ? '' : route.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) {
    return path.join(outDir, 'index.html');
  }
  return path.join(outDir, normalized, 'index.html');
}
