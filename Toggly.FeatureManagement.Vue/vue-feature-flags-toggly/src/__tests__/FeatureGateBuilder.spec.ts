import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FeatureGateBuilder from '../components/FeatureGateBuilder.vue'
import { Toggly } from '../plugins/toggly.service'

describe('FeatureGateBuilder', () => {
  let service: Toggly

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    service = new Toggly()
    service.init({
      featureDefaults: { Enabled: true, Disabled: false },
    })
  })

  it('exposes enabled=true via scoped slot', async () => {
    const wrapper = mount(FeatureGateBuilder, {
      props: { featureKey: 'Enabled' },
      global: { provide: { $toggly: service } },
      slots: {
        default: `<span class="state">{{ enabled ? 'on' : 'off' }}</span>`,
      },
    })

    await flushPromises()
    expect(wrapper.find('.state').text()).toBe('on')
  })

  it('exposes enabled=false when feature is disabled', async () => {
    const wrapper = mount(FeatureGateBuilder, {
      props: { featureKey: 'Disabled' },
      global: { provide: { $toggly: service } },
      slots: {
        default: `<span class="state">{{ enabled ? 'on' : 'off' }}</span>`,
      },
    })

    await flushPromises()
    expect(wrapper.find('.state').text()).toBe('off')
  })
})
