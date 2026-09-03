import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Feature, FeatureOff, FeatureGate } from '../src/components'
import { TogglyProvider } from '../src/context'

vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
})

function renderWithFeatures(
  ui: ReactNode,
  features: Record<string, boolean>
) {
  return render(
    <TogglyProvider
      config={{ appKey: 'test-key' }}
      initialFeatures={features}
      autoInit={false}
    >
      {ui}
    </TogglyProvider>
  )
}

describe('Feature.Fallback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the fallback prop when the feature is off', () => {
    renderWithFeatures(
      <Feature featureKey="new-ui" fallback={<span>legacy</span>}>
        <span>next</span>
      </Feature>,
      { 'new-ui': false }
    )
    expect(screen.getByText('legacy')).toBeTruthy()
    expect(screen.queryByText('next')).toBeNull()
  })

  it('renders nested Feature.Fallback when the feature is off', () => {
    renderWithFeatures(
      <Feature featureKey="new-ui">
        <span>next</span>
        <Feature.Fallback>
          <span>legacy</span>
        </Feature.Fallback>
      </Feature>,
      { 'new-ui': false }
    )
    expect(screen.getByText('legacy')).toBeTruthy()
    expect(screen.queryByText('next')).toBeNull()
  })

  it('prefers the fallback prop over nested Fallback', () => {
    renderWithFeatures(
      <Feature featureKey="new-ui" fallback={<span>prop</span>}>
        <span>next</span>
        <Feature.Fallback>
          <span>nested</span>
        </Feature.Fallback>
      </Feature>,
      { 'new-ui': false }
    )
    expect(screen.getByText('prop')).toBeTruthy()
    expect(screen.queryByText('nested')).toBeNull()
  })

  it('does not render nested Fallback when the feature is on', () => {
    renderWithFeatures(
      <Feature featureKey="new-ui">
        <span>next</span>
        <Feature.Fallback>
          <span>legacy</span>
        </Feature.Fallback>
      </Feature>,
      { 'new-ui': true }
    )
    expect(screen.getByText('next')).toBeTruthy()
    expect(screen.queryByText('legacy')).toBeNull()
  })

  it('supports FeatureOff.Fallback', () => {
    renderWithFeatures(
      <FeatureOff featureKey="maintenance-complete">
        <span>banner</span>
        <FeatureOff.Fallback>
          <span>site</span>
        </FeatureOff.Fallback>
      </FeatureOff>,
      { 'maintenance-complete': true }
    )
    expect(screen.getByText('site')).toBeTruthy()
    expect(screen.queryByText('banner')).toBeNull()
  })

  it('supports FeatureGate.Fallback', () => {
    renderWithFeatures(
      <FeatureGate featureKeys={['premium']}>
        <span>paid</span>
        <FeatureGate.Fallback>
          <span>upgrade</span>
        </FeatureGate.Fallback>
      </FeatureGate>,
      { premium: false }
    )
    expect(screen.getByText('upgrade')).toBeTruthy()
    expect(screen.queryByText('paid')).toBeNull()
  })
})
