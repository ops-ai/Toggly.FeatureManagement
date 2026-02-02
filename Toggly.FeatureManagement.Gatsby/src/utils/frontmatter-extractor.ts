/**
 * Frontmatter Extractor Utility
 * 
 * Extracts x-feature frontmatter from Gatsby pages during build
 */

import type { PageFeatureMap } from '../types/index.js';

/**
 * Extract feature flag from page context
 * 
 * Checks page.context.frontmatter for x-feature field
 * 
 * @param page - Gatsby page object
 * @returns Feature flag key or null
 */
export function extractFeatureFromPage(page: any): string | null {
  // Check if page has frontmatter in context
  if (page.context?.frontmatter?.['x-feature']) {
    return page.context.frontmatter['x-feature'];
  }

  // Check if page has frontmatter directly
  if (page.frontmatter?.['x-feature']) {
    return page.frontmatter['x-feature'];
  }

  // Check if page has pageContext with frontmatter
  if (page.pageContext?.frontmatter?.['x-feature']) {
    return page.pageContext.frontmatter['x-feature'];
  }

  return null;
}

/**
 * Build page feature map from extracted features
 * 
 * @param pages - Array of [path, featureKey] tuples
 * @returns PageFeatureMap object
 */
export function buildPageFeatureMap(pages: Array<[string, string]>): PageFeatureMap {
  const map: PageFeatureMap = {};
  
  for (const [path, featureKey] of pages) {
    map[path] = featureKey;
  }
  
  return map;
}

/**
 * Normalize page path for consistent mapping
 * 
 * @param path - Page path
 * @returns Normalized path
 */
export function normalizePagePath(path: string): string {
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  
  // Remove trailing slash except for root
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  
  return path;
}
