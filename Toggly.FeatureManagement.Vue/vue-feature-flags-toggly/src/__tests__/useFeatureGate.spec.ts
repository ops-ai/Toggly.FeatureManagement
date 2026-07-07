import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, computed, nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { Toggly } from '../plugins/toggly.service'
import { useFeatureFlag, useFeatureGate } from '../composables/useFeatureGate'

describe('useFeatureGate composables', () => {
  let service: Toggly

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    service = new Toggly()
    service.init({
      featureDefaults: { PremiumCheckout: true, Disabled: false, A: true, C: false },
    })
  })

  function mountGate(options: Parameters<typeof useFeatureGate>[0]) {
    const state = { isEnabled: false, isLoading: true }

    const Host = defineComponent({
      setup() {
        const gate = useFeatureGate({ ...options, toggly: service })
        return gate
      },
      template: '<div />',
    })

    return mount(Host)
  }

  it('useFeatureFlag resolves a single key', async () => {
    const Host = defineComponent({
      setup() {
        return useFeatureFlag('PremiumCheckout', { toggly: service })
      },
      template: '<div />',
    })

    const wrapper = mount(Host)
    await flushPromises()
    expect(wrapper.vm.isEnabled).toBe(true)
  })

  it('useFeatureGate resolves featureKeys with requirement all', async () => {
    const wrapper = mountGate({ featureKeys: ['A', 'C'], requirement: 'all' })
    await flushPromises()
    expect(wrapper.vm.isEnabled).toBe(false)
  })

  it('useFeatureGate resolves featureKeys with requirement any', async () => {
    const wrapper = mountGate({ featureKeys: ['A', 'C'], requirement: 'any' })
    await flushPromises()
    expect(wrapper.vm.isEnabled).toBe(true)
  })

  it('re-evaluates when requirement option changes', async () => {
    const Host = defineComponent({
      props: {
        requirement: {
          type: String,
          default: 'all',
        },
      },
      setup(props) {
        return useFeatureGate(
          computed(() => ({
            featureKeys: ['A', 'C'],
            requirement: props.requirement as 'all' | 'any',
            toggly: service,
          })),
        )
      },
      template: '<div />',
    })

    const wrapper = mount(Host)
    await flushPromises()
    expect(wrapper.vm.isEnabled).toBe(false)

    await wrapper.setProps({ requirement: 'any' })
    await flushPromises()
    await nextTick()
    expect(wrapper.vm.isEnabled).toBe(true)
  })
})
