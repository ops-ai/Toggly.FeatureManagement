import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApp, defineComponent, h, inject } from 'vue';
import { mount } from '@vue/test-utils';
import plugin from '../plugins/toggly';
import { Toggly } from '../plugins/toggly.service';

describe('Toggly Vue Plugin', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('should install on a Vue app', () => {
    const app = createApp({ render: () => null });
    expect(() => {
      app.use(plugin, { featureDefaults: { F1: true } });
    }).not.toThrow();
  });

  it('should provide $toggly service via inject', () => {
    const TestChild = defineComponent({
      setup() {
        const toggly = inject<Toggly>('$toggly');
        return { hasToggly: !!toggly };
      },
      render() {
        return h('span', { class: 'result' }, this.hasToggly ? 'yes' : 'no');
      },
    });

    const wrapper = mount(TestChild, {
      global: {
        plugins: [[plugin, { featureDefaults: { F1: true } }]],
      },
    });

    expect(wrapper.find('.result').text()).toBe('yes');
  });

  it('should register Feature component globally', () => {
    const app = createApp({ render: () => null });
    app.use(plugin, { featureDefaults: { F1: true } });

    // The component should be registered globally
    expect(app.component('Feature')).toBeDefined();
  });

  it('should pass options to the Toggly service', async () => {
    const TestChild = defineComponent({
      setup() {
        const toggly = inject<Toggly>('$toggly');
        return { toggly };
      },
      render() {
        return h('span', {
          class: 'eval',
          'data-show': this.toggly?.shouldShowFeatureDuringEvaluation,
        });
      },
    });

    const wrapper = mount(TestChild, {
      global: {
        plugins: [[plugin, {
          featureDefaults: { F1: true },
          showFeatureDuringEvaluation: true,
        }]],
      },
    });

    expect(wrapper.find('.eval').attributes('data-show')).toBe('true');
  });
});
