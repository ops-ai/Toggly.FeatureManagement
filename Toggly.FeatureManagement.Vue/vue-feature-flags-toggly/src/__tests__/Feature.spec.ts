import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import Feature from '../components/Feature.vue';
import { Toggly } from '../plugins/toggly.service';

describe('Feature Component', () => {
  let service: Toggly;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    service = new Toggly();
    service.init({
      featureDefaults: { Enabled: true, Disabled: false, A: true, B: true, C: false },
    });
  });

  function mountFeature(props: Record<string, any> = {}) {
    return mount(Feature, {
      props,
      global: {
        provide: { $toggly: service },
      },
      slots: { default: '<span class="content">Visible</span>' },
    });
  }

  describe('Basic rendering', () => {
    it('should render slot when feature is enabled', async () => {
      const wrapper = mountFeature({ featureKey: 'Enabled' });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(true);
    });

    it('should not render when feature is disabled', async () => {
      const wrapper = mountFeature({ featureKey: 'Disabled' });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(false);
    });

    it('should not render for unknown feature', async () => {
      const wrapper = mountFeature({ featureKey: 'Unknown' });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(false);
    });
  });

  describe('featureKeys prop', () => {
    it('should render when all keys enabled', async () => {
      const wrapper = mountFeature({ featureKeys: ['A', 'B'] });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(true);
    });

    it('should not render when some keys disabled (all)', async () => {
      const wrapper = mountFeature({ featureKeys: ['A', 'C'] });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(false);
    });
  });

  describe('requirement prop', () => {
    it('should render when any key enabled (requirement: any)', async () => {
      const wrapper = mountFeature({ featureKeys: ['A', 'C'], requirement: 'any' });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(true);
    });

    it('should not render when none enabled (requirement: any)', async () => {
      const wrapper = mountFeature({ featureKeys: ['C'], requirement: 'any' });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(false);
    });
  });

  describe('negate prop', () => {
    it('should hide when enabled and negate true', async () => {
      const wrapper = mountFeature({ featureKey: 'Enabled', negate: true });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(false);
    });

    it('should show when disabled and negate true', async () => {
      const wrapper = mountFeature({ featureKey: 'Disabled', negate: true });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(true);
    });
  });

  describe('Combined featureKey + featureKeys', () => {
    it('should combine into single gate', async () => {
      const wrapper = mountFeature({ featureKey: 'A', featureKeys: ['B'] });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(true);
    });

    it('should fail combined gate when one disabled', async () => {
      const wrapper = mountFeature({ featureKey: 'A', featureKeys: ['C'] });
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(false);
    });
  });

  describe('Empty gate', () => {
    it('should render for empty gate (no featureKey/featureKeys)', async () => {
      const wrapper = mountFeature({});
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(true);
    });
  });

  describe('showFeatureDuringEvaluation', () => {
    it('should show during evaluation when configured', async () => {
      const evalService = new Toggly();
      evalService.init({
        featureDefaults: { F1: true },
        showFeatureDuringEvaluation: true,
      });

      const wrapper = mount(Feature, {
        props: { featureKey: 'F1' },
        global: { provide: { $toggly: evalService } },
        slots: { default: '<span class="content">Visible</span>' },
      });

      // Before flushPromises, shouldShow should be true (from showFeatureDuringEvaluation)
      await flushPromises();
      expect(wrapper.find('.content').exists()).toBe(true);
    });
  });
});
