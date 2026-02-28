import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import {
  generatePageFeaturesManifest,
  generateConfigManifest,
  generateManifests,
} from '../../utils/manifest-generator.js';

vi.mock('fs', () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Manifest Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ─── generatePageFeaturesManifest ──────────────────────
  describe('generatePageFeaturesManifest', () => {
    it('should write page features manifest', async () => {
      const pageFeatureMap = { '/about': 'beta', '/pricing': 'premium' };
      await generatePageFeaturesManifest('/public', pageFeatureMap);

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('toggly-page-features.json'),
        JSON.stringify(pageFeatureMap, null, 2),
        'utf-8'
      );
    });

    it('should log success message', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await generatePageFeaturesManifest('/public', {});

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Generated page features manifest')
      );
    });

    it('should throw on write error', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValueOnce(new Error('Write failed'));

      await expect(
        generatePageFeaturesManifest('/public', {})
      ).rejects.toThrow('Write failed');
    });

    it('should log error on write failure', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(fs.promises.writeFile).mockRejectedValueOnce(new Error('Write failed'));

      try {
        await generatePageFeaturesManifest('/public', {});
      } catch {
        // Expected
      }

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to generate page features manifest'),
        expect.any(Error)
      );
    });
  });

  // ─── generateConfigManifest ──────────────────────
  describe('generateConfigManifest', () => {
    it('should write sanitized config manifest', async () => {
      await generateConfigManifest('/public', {
        appKey: 'my-key',
        environment: 'Staging',
        baseURI: 'https://custom.toggly.io',
        flagDefaults: { F1: true },
        isDebug: true,
      });

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string);

      expect(written).toEqual({
        appKey: 'my-key',
        environment: 'Staging',
        baseURI: 'https://custom.toggly.io',
      });
      // Should NOT include sensitive data
      expect(written).not.toHaveProperty('flagDefaults');
      expect(written).not.toHaveProperty('isDebug');
    });

    it('should use default values for environment and baseURI', async () => {
      await generateConfigManifest('/public', {
        appKey: 'my-key',
      });

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0];
      const written = JSON.parse(writeCall[1] as string);

      expect(written.environment).toBe('Production');
      expect(written.baseURI).toBe('https://definitions.toggly.io');
    });

    it('should throw on write error', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValueOnce(new Error('Write failed'));

      await expect(
        generateConfigManifest('/public', { appKey: 'key' })
      ).rejects.toThrow('Write failed');
    });
  });

  // ─── generateManifests ──────────────────────
  describe('generateManifests', () => {
    it('should call both generators', async () => {
      await generateManifests('/public', { '/about': 'beta' }, { appKey: 'key' });

      expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
    });

    it('should write page features and config manifests', async () => {
      await generateManifests('/public', {}, { appKey: 'my-key' });

      const paths = vi.mocked(fs.promises.writeFile).mock.calls.map(
        (call) => call[0]
      );
      expect(paths).toEqual(
        expect.arrayContaining([
          expect.stringContaining('toggly-page-features.json'),
          expect.stringContaining('toggly-config.json'),
        ])
      );
    });
  });
});
