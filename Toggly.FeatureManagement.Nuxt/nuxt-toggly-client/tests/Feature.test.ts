import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed, h } from 'vue'
import { Feature, FeatureEnabled, FeatureDisabled } from '../src/components/Feature'

const mockUseFeatureProps = vi.fn()

vi.mock('../src/composables/useFeatureGate', () => ({
  useFeatureProps: (...args: unknown[]) => mockUseFeatureProps(...args),
}))

function createMockReturn(enabled = true, loading = false) {
  return {
    isEnabled: computed(() => enabled),
    isDisabled: computed(() => !enabled),
    isLoading: ref(loading),
    refresh: vi.fn(),
  }
}

describe('Feature component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render default slot when feature is enabled', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(true))

    const wrapper = mount(Feature, {
      props: { featureKey: 'my-feature' },
      slots: { default: () => h('div', 'enabled content') },
    })

    expect(wrapper.text()).toBe('enabled content')
  })

  it('should render nothing when feature is disabled (use negate for off path)', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(false))

    const wrapper = mount(Feature, {
      props: { featureKey: 'my-feature' },
      slots: {
        default: () => h('div', 'enabled content'),
        // legacy #fallback is ignored
        fallback: () => h('div', 'fallback content'),
      },
    })

    expect(wrapper.text()).toBe('')
  })

  it('should render nothing when disabled with no fallback', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(false))

    const wrapper = mount(Feature, {
      props: { featureKey: 'my-feature' },
      slots: { default: () => h('div', 'enabled content') },
    })

    expect(wrapper.text()).toBe('')
  })

  it('should render loading slot while loading', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(false, true))

    const wrapper = mount(Feature, {
      props: { featureKey: 'my-feature' },
      slots: {
        default: () => h('div', 'content'),
        loading: () => h('div', 'loading...'),
      },
    })

    expect(wrapper.text()).toBe('loading...')
  })

  it('should render default slot when loading but no loading slot', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(true, true))

    const wrapper = mount(Feature, {
      props: { featureKey: 'my-feature' },
      slots: { default: () => h('div', 'content') },
    })

    expect(wrapper.text()).toBe('content')
  })

  it('should pass props to useFeatureProps', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(true))

    mount(Feature, {
      props: {
        featureKey: 'my-feature',
        featureKeys: ['feature-a', 'feature-b'],
        requirement: 'any' as const,
        negate: true,
      },
      slots: { default: () => h('div', 'content') },
    })

    expect(mockUseFeatureProps).toHaveBeenCalledWith(
      expect.objectContaining({
        featureKey: 'my-feature',
        featureKeys: ['feature-a', 'feature-b'],
        requirement: 'any',
        negate: true,
      })
    )
  })

  it('should use default prop values', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(true))

    mount(Feature, {
      props: { featureKey: 'my-feature' },
      slots: { default: () => h('div', 'content') },
    })

    expect(mockUseFeatureProps).toHaveBeenCalledWith(
      expect.objectContaining({
        featureKey: 'my-feature',
        requirement: 'all',
        negate: false,
      })
    )
  })
})

describe('FeatureEnabled component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render when feature is enabled', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(true))

    const wrapper = mount(FeatureEnabled, {
      props: { featureKey: 'my-feature' },
      slots: { default: () => h('div', 'enabled content') },
    })

    expect(wrapper.text()).toBe('enabled content')
  })

  it('should not render when feature is disabled', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(false))

    const wrapper = mount(FeatureEnabled, {
      props: { featureKey: 'my-feature' },
      slots: { default: () => h('div', 'enabled content') },
    })

    expect(wrapper.text()).toBe('')
  })

  it('should pass featureKey to useFeatureProps', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(true))

    mount(FeatureEnabled, {
      props: { featureKey: 'test-feature' },
      slots: { default: () => h('div', 'content') },
    })

    expect(mockUseFeatureProps).toHaveBeenCalledWith(
      expect.objectContaining({ featureKey: 'test-feature' })
    )
  })

  it('should render nothing when no default slot and enabled', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(true))

    const wrapper = mount(FeatureEnabled, {
      props: { featureKey: 'my-feature' },
    })

    expect(wrapper.text()).toBe('')
  })
})

describe('FeatureDisabled component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render when feature is disabled', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(false))

    const wrapper = mount(FeatureDisabled, {
      props: { featureKey: 'my-feature' },
      slots: { default: () => h('div', 'disabled content') },
    })

    expect(wrapper.text()).toBe('disabled content')
  })

  it('should not render when feature is enabled', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(true))

    const wrapper = mount(FeatureDisabled, {
      props: { featureKey: 'my-feature' },
      slots: { default: () => h('div', 'disabled content') },
    })

    expect(wrapper.text()).toBe('')
  })

  it('should pass featureKey to useFeatureProps', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(false))

    mount(FeatureDisabled, {
      props: { featureKey: 'test-feature' },
      slots: { default: () => h('div', 'content') },
    })

    expect(mockUseFeatureProps).toHaveBeenCalledWith(
      expect.objectContaining({ featureKey: 'test-feature' })
    )
  })

  it('should render nothing when no default slot and disabled', () => {
    mockUseFeatureProps.mockReturnValue(createMockReturn(false))

    const wrapper = mount(FeatureDisabled, {
      props: { featureKey: 'my-feature' },
    })

    expect(wrapper.text()).toBe('')
  })
})
