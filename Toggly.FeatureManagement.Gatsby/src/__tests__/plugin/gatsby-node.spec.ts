import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  onPreBootstrap,
  onCreatePage,
  onPostBuild,
  pluginOptionsSchema,
} from '../../plugin/gatsby-node.js';

// Mock manifest generator
vi.mock('../../utils/manifest-generator.js', () => ({
  generateManifests: vi.fn().mockResolvedValue(undefined),
}));

import { generateManifests } from '../../utils/manifest-generator.js';

describe('gatsby-node', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── onPreBootstrap ──────────────────────
  describe('onPreBootstrap', () => {
    it('should warn when no appKey provided', () => {
      const reporter = {
        warn: vi.fn(),
        info: vi.fn(),
      };

      onPreBootstrap!(
        { reporter } as any,
        { plugins: [] } as any
      );

      expect(reporter.warn).toHaveBeenCalledWith(
        expect.stringContaining('No appKey provided')
      );
    });

    it('should not warn when appKey is provided', () => {
      const reporter = {
        warn: vi.fn(),
        info: vi.fn(),
      };

      onPreBootstrap!(
        { reporter } as any,
        { appKey: 'test-key', plugins: [] } as any
      );

      expect(reporter.warn).not.toHaveBeenCalled();
    });

    it('should log in debug mode', () => {
      const reporter = {
        warn: vi.fn(),
        info: vi.fn(),
      };

      onPreBootstrap!(
        { reporter } as any,
        { appKey: 'test-key', isDebug: true, plugins: [] } as any
      );

      expect(reporter.info).toHaveBeenCalledWith(
        expect.stringContaining('Debug mode enabled')
      );
    });
  });

  // ─── onCreatePage ──────────────────────
  describe('onCreatePage', () => {
    it('should extract feature and update page context', async () => {
      const deletePage = vi.fn();
      const createPage = vi.fn();
      const page = {
        path: '/about/',
        context: {
          frontmatter: { 'x-feature': 'beta-feature' },
        },
      };

      await onCreatePage!(
        { page, actions: { createPage, deletePage } } as any,
        { plugins: [] } as any
      );

      expect(deletePage).toHaveBeenCalledWith(page);
      expect(createPage).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            togglyFeature: 'beta-feature',
          }),
        })
      );
    });

    it('should not modify page without x-feature', async () => {
      const deletePage = vi.fn();
      const createPage = vi.fn();
      const page = {
        path: '/about',
        context: {},
      };

      await onCreatePage!(
        { page, actions: { createPage, deletePage } } as any,
        { plugins: [] } as any
      );

      expect(deletePage).not.toHaveBeenCalled();
      expect(createPage).not.toHaveBeenCalled();
    });

    it('should log in debug mode', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const deletePage = vi.fn();
      const createPage = vi.fn();
      const page = {
        path: '/about',
        context: {
          frontmatter: { 'x-feature': 'beta' },
        },
      };

      await onCreatePage!(
        { page, actions: { createPage, deletePage } } as any,
        { isDebug: true, plugins: [] } as any
      );

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('requires feature')
      );
    });
  });

  // ─── onPostBuild ──────────────────────
  describe('onPostBuild', () => {
    it('should generate manifests', async () => {
      const reporter = {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
      };
      const store = {
        getState: () => ({
          program: { directory: '/project' },
        }),
      };

      await onPostBuild!(
        { store, reporter } as any,
        { appKey: 'test-key', plugins: [] } as any
      );

      expect(generateManifests).toHaveBeenCalled();
      expect(reporter.success).toHaveBeenCalledWith(
        expect.stringContaining('Generated manifests')
      );
    });

    it('should report error on manifest generation failure', async () => {
      vi.mocked(generateManifests).mockRejectedValueOnce(new Error('Gen failed'));

      const reporter = {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
      };
      const store = {
        getState: () => ({
          program: { directory: '/project' },
        }),
      };

      await onPostBuild!(
        { store, reporter } as any,
        { appKey: 'test-key', plugins: [] } as any
      );

      expect(reporter.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to generate manifests'),
        expect.any(Error)
      );
    });

    it('should log page feature map in debug mode', async () => {
      const reporter = {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
      };
      const store = {
        getState: () => ({
          program: { directory: '/project' },
        }),
      };

      await onPostBuild!(
        { store, reporter } as any,
        { appKey: 'test-key', isDebug: true, plugins: [] } as any
      );

      expect(reporter.info).toHaveBeenCalledWith(
        expect.stringContaining('Page feature map')
      );
    });
  });

  // ─── pluginOptionsSchema ──────────────────────
  describe('pluginOptionsSchema', () => {
    const createChainable = () => {
      const obj: any = {};
      const methods = [
        'required', 'default', 'description', 'optional',
        'integer', 'min', 'pattern', 'string', 'boolean', 'number',
        'items', 'array',
      ];
      methods.forEach((method) => {
        obj[method] = vi.fn().mockReturnValue(obj);
      });
      return obj;
    };

    const createMockJoi = () => ({
      object: vi.fn().mockReturnValue(createChainable()),
      string: vi.fn().mockReturnValue(createChainable()),
      boolean: vi.fn().mockReturnValue(createChainable()),
      number: vi.fn().mockReturnValue(createChainable()),
      array: vi.fn().mockReturnValue(createChainable()),
    });

    it('should return a Joi schema', () => {
      const Joi = createMockJoi();
      const result = pluginOptionsSchema!({ Joi } as any);
      expect(result).toBeTruthy();
      expect(Joi.object).toHaveBeenCalled();
    });

    it('declares groups, claims, and signing options accepted by init', () => {
      const Joi = createMockJoi();
      pluginOptionsSchema!({ Joi } as any);

      // Nested Joi.object() for claims is evaluated before the top-level schema
      // object is passed — find the call that received the plugin options map.
      const schemaCall = Joi.object.mock.calls.find(
        (call: unknown[]) => call[0] && typeof call[0] === 'object'
      );
      expect(schemaCall).toBeDefined();
      const schemaKeys = Object.keys(schemaCall![0]);
      expect(schemaKeys).toEqual(
        expect.arrayContaining([
          'groups',
          'claims',
          'verifySignatures',
          'allowedKeyIds',
          'maxSignatureAgeSeconds',
        ])
      );
    });
  });
});
