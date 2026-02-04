import { describe, it, expect } from 'vitest';
import {
  extractFeatureFromPage,
  buildPageFeatureMap,
  normalizePagePath,
} from '../../utils/frontmatter-extractor.js';

describe('Frontmatter Extractor', () => {
  // ─── extractFeatureFromPage ──────────────────────
  describe('extractFeatureFromPage', () => {
    it('should extract from context.frontmatter', () => {
      const page = {
        context: { frontmatter: { 'x-feature': 'beta-feature' } },
      };
      expect(extractFeatureFromPage(page)).toBe('beta-feature');
    });

    it('should extract from frontmatter directly', () => {
      const page = {
        frontmatter: { 'x-feature': 'new-dashboard' },
      };
      expect(extractFeatureFromPage(page)).toBe('new-dashboard');
    });

    it('should extract from pageContext.frontmatter', () => {
      const page = {
        pageContext: { frontmatter: { 'x-feature': 'premium' } },
      };
      expect(extractFeatureFromPage(page)).toBe('premium');
    });

    it('should return null when no x-feature found', () => {
      const page = { context: {} };
      expect(extractFeatureFromPage(page)).toBeNull();
    });

    it('should return null for empty page object', () => {
      expect(extractFeatureFromPage({})).toBeNull();
    });

    it('should return null when frontmatter has no x-feature', () => {
      const page = {
        context: { frontmatter: { title: 'Hello' } },
      };
      expect(extractFeatureFromPage(page)).toBeNull();
    });

    it('should prefer context.frontmatter over frontmatter', () => {
      const page = {
        context: { frontmatter: { 'x-feature': 'from-context' } },
        frontmatter: { 'x-feature': 'from-direct' },
      };
      expect(extractFeatureFromPage(page)).toBe('from-context');
    });
  });

  // ─── buildPageFeatureMap ──────────────────────
  describe('buildPageFeatureMap', () => {
    it('should build map from tuples', () => {
      const pages: Array<[string, string]> = [
        ['/about', 'beta'],
        ['/pricing', 'premium'],
      ];
      expect(buildPageFeatureMap(pages)).toEqual({
        '/about': 'beta',
        '/pricing': 'premium',
      });
    });

    it('should return empty map for empty array', () => {
      expect(buildPageFeatureMap([])).toEqual({});
    });

    it('should handle single entry', () => {
      const pages: Array<[string, string]> = [['/test', 'feature-x']];
      expect(buildPageFeatureMap(pages)).toEqual({ '/test': 'feature-x' });
    });
  });

  // ─── normalizePagePath ──────────────────────
  describe('normalizePagePath', () => {
    it('should add leading slash when missing', () => {
      expect(normalizePagePath('about')).toBe('/about');
    });

    it('should remove trailing slash', () => {
      expect(normalizePagePath('/about/')).toBe('/about');
    });

    it('should keep root path as-is', () => {
      expect(normalizePagePath('/')).toBe('/');
    });

    it('should not modify already normalized path', () => {
      expect(normalizePagePath('/about')).toBe('/about');
    });

    it('should handle both issues at once', () => {
      expect(normalizePagePath('about/')).toBe('/about');
    });

    it('should handle deeply nested paths', () => {
      expect(normalizePagePath('/docs/api/v2/')).toBe('/docs/api/v2');
    });
  });
});
