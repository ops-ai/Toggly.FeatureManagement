import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Feature, FeatureGate } from '../src/components'
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

describe('Feature negate', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children when the feature is on', () => {
    renderWithFeatures(
      <Feature featureKey="new-ui">
        <span>next</span>
      </Feature>,
      { 'new-ui': true }
    )
    expect(screen.getByText('next')).toBeTruthy()
  })

  it('hides children when the feature is off', () => {
    renderWithFeatures(
      <Feature featureKey="new-ui">
        <span>next</span>
      </Feature>,
      { 'new-ui': false }
    )
    expect(screen.queryByText('next')).toBeNull()
  })

  it('renders children when negate is set and the feature is off', () => {
    renderWithFeatures(
      <Feature featureKey="new-ui" negate>
        <span>legacy</span>
      </Feature>,
      { 'new-ui': false }
    )
    expect(screen.getByText('legacy')).toBeTruthy()
  })

  it('hides children when negate is set and the feature is on', () => {
    renderWithFeatures(
      <Feature featureKey="maintenance-complete" negate>
        <span>banner</span>
      </Feature>,
      { 'maintenance-complete': true }
    )
    expect(screen.queryByText('banner')).toBeNull()
  })

  it('FeatureGate negate renders when the gate fails', () => {
    renderWithFeatures(
      <FeatureGate featureKeys={['premium']} negate>
        <span>upgrade</span>
      </FeatureGate>,
      { premium: false }
    )
    expect(screen.getByText('upgrade')).toBeTruthy()
  })
})
