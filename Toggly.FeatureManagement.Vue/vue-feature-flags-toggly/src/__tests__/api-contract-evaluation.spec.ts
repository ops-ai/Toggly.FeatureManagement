/**
 * Public entry-point flag evaluation against the Toggly evaluated-signed API shape.
 *
 * Realistic HTTP responses use the `{ defs: ... }` envelope returned by
 * `/evaluated-signed` and `/evaluated-variants-signed` (verifySignatures off).
 * Filter-parity fixtures apply to local/server eval engines, not this browser
 * client which consumes already-evaluated definitions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { Toggly } from '../plugins/toggly.service'
import { useFeatureFlag, useFeatureGate } from '../composables/useFeatureGate'
import { useVariant } from '../composables/useVariant'
import Feature from '../components/Feature.vue'
import FeatureGateBuilder from '../components/FeatureGateBuilder.vue'
import { createMockFetchResponse } from './test-helpers'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('evaluated-signed API contract evaluation', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches evaluated-signed and evaluates through public service APIs', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse(
        { defs: { FlagOn: true, FlagOff: false } },
        200,
        'OK',
      ),
    )

    const service = new Toggly().init({
      appKey: 'contract-app',
      environment: 'Production',
      baseURI: 'https://definitions.example.test',
      enableLiveUpdates: false,
      enableTelemetry: false,
      persistCache: false,
      verifySignatures: false,
    })

    try {
      expect(await service.isFeatureOn('FlagOn')).toBe(true)
      expect(await service.isFeatureOff('FlagOff')).toBe(true)
      expect(await service.isFeatureOn('Missing')).toBe(false)
      expect(await service.evaluateFeatureGate(['FlagOn', 'FlagOff'], 'any')).toBe(true)
      expect(await service.evaluateFeatureGate(['FlagOn', 'FlagOff'], 'all')).toBe(false)
      expect(await service.evaluateFeatureGate(['FlagOff'], 'all', true)).toBe(true)

      const calledUrl = String(mockFetch.mock.calls[0][0])
      expect(calledUrl).toContain('/evaluated-signed/contract-app/Production')
      expect(calledUrl).not.toContain('/definitions-signed/')
      expect(calledUrl).not.toContain('/evaluated-variants-signed/')
    } finally {
      service.dispose()
    }
  })

  it('fetches evaluated-variants-signed and exposes variants via public APIs', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockFetchResponse(
        {
          defs: {
            FlagOn: { enabled: true, variant: 'blue', configurationValue: 7 },
            FlagOff: { enabled: false, variant: 'control' },
          },
        },
        200,
        'OK',
      ),
    )

    const service = new Toggly().init({
      appKey: 'contract-app',
      environment: 'Production',
      baseURI: 'https://definitions.example.test',
      enableLiveUpdates: false,
      enableTelemetry: false,
      persistCache: false,
      verifySignatures: false,
      enableVariants: true,
    })

    try {
      expect(await service.isFeatureOn('FlagOn')).toBe(true)
      expect(await service.isFeatureOff('FlagOff')).toBe(true)
      expect(service.getVariant('FlagOn')).toEqual({
        name: 'blue',
        configurationValue: 7,
      })
      expect(await service.getVariantValue('FlagOn')).toBe(7)

      const calledUrl = String(mockFetch.mock.calls[0][0])
      expect(calledUrl).toContain('/evaluated-variants-signed/contract-app/Production')
    } finally {
      service.dispose()
    }
  })

  it('drives Feature, FeatureGateBuilder, and composables from evaluated defs', async () => {
    mockFetch.mockResolvedValue(
      createMockFetchResponse(
        {
          defs: {
            FlagOn: { enabled: true, variant: 'blue', configurationValue: 'payload' },
            FlagOff: { enabled: false, variant: 'control' },
          },
        },
        200,
        'OK',
      ),
    )

    const service = new Toggly().init({
      appKey: 'contract-app',
      environment: 'Production',
      baseURI: 'https://definitions.example.test',
      enableLiveUpdates: false,
      enableTelemetry: false,
      persistCache: false,
      verifySignatures: false,
      enableVariants: true,
    })

    try {
      // Hydrate definitions before mounting UI so each public entry point
      // evaluates against the same loaded contract payload.
      expect(await service.isFeatureOn('FlagOn')).toBe(true)

      const FlagHost = defineComponent({
        setup() {
          return useFeatureFlag('FlagOn', { toggly: service })
        },
        template: '<span data-testid="flag">{{ isEnabled }}</span>',
      })
      const GateHost = defineComponent({
        setup() {
          return useFeatureGate({
            featureKeys: ['FlagOn', 'FlagOff'],
            requirement: 'any',
            toggly: service,
          })
        },
        template: '<span data-testid="gate">{{ isEnabled }}</span>',
      })
      const VariantHost = defineComponent({
        setup() {
          return useVariant('FlagOn', service)
        },
        template:
          '<span data-testid="variant">{{ variant?.name }}</span><span data-testid="value">{{ variantValue }}</span>',
      })

      const wrapper = mount(
        defineComponent({
          render: () =>
            h('div', [
              h(FlagHost),
              h(GateHost),
              h(VariantHost),
              h(Feature, { featureKey: 'FlagOn' }, () => h('span', { class: 'feature-on' }, 'visible')),
              h(Feature, { featureKey: 'FlagOff' }, () => h('span', { class: 'feature-off' }, 'hidden')),
              h(
                FeatureGateBuilder,
                { featureKey: 'FlagOn' },
                {
                  default: ({ enabled }: { enabled: boolean }) =>
                    h('span', { class: 'builder' }, String(enabled)),
                },
              ),
            ]),
        }),
        { global: { provide: { $toggly: service } } },
      )

      await flushPromises()

      expect(wrapper.get('[data-testid="flag"]').text()).toBe('true')
      expect(wrapper.get('[data-testid="gate"]').text()).toBe('true')
      expect(wrapper.get('[data-testid="variant"]').text()).toBe('blue')
      expect(wrapper.get('[data-testid="value"]').text()).toBe('payload')
      expect(wrapper.find('.feature-on').exists()).toBe(true)
      expect(wrapper.find('.feature-off').exists()).toBe(false)
      expect(wrapper.get('.builder').text()).toBe('true')

      wrapper.unmount()
    } finally {
      service.dispose()
    }
  })
})
