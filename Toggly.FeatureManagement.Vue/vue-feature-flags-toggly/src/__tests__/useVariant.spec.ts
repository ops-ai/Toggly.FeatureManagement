import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { Toggly } from '../plugins/toggly.service';
import { useVariant } from '../composables/useVariant';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('useVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes variant after load when service is passed explicitly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({
          defs: {
            MyFeature: { enabled: true, variant: 'B', configurationValue: 'hello' },
          },
        }),
      text: () => Promise.resolve(JSON.stringify({
          defs: {
            MyFeature: { enabled: true, variant: 'B', configurationValue: 'hello' },
          },
        })),
    });

    const service = new Toggly();
    service.init({
      appKey: 'k',
      environment: 'Production',
      enableVariants: true,
      enableLiveUpdates: false,
    });

    const Comp = defineComponent({
      setup() {
        return useVariant('MyFeature', service);
      },
      template: '<div />',
    });

    const wrapper = mount(Comp);
    await flushPromises();
    await nextTick();

    const vm = wrapper.vm as unknown as {
      variant: { name: string; configurationValue?: unknown } | null;
      variantValue: unknown;
      isLoading: boolean;
    };
    expect(vm.variant).toEqual({ name: 'B', configurationValue: 'hello' });
    expect(vm.variantValue).toBe('hello');
    expect(vm.isLoading).toBe(false);
  });
});
