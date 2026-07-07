import React from 'react'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Provider } from '../contexts/toggly.context'
import { Toggly } from '../services'
import { useFeatureFlag, useFeatureGate } from './useFeatureFlag'

function FlagProbe({ featureKey }: { featureKey: string }) {
  const { isEnabled, isLoading } = useFeatureFlag(featureKey)
  return (
    <span data-testid="state">
      {isLoading ? 'loading' : isEnabled ? 'on' : 'off'}
    </span>
  )
}

function GateProbe({ featureKeys }: { featureKeys: string[] }) {
  const { isEnabled } = useFeatureGate(featureKeys, { requirement: 'all' })
  return <span data-testid="gate">{isEnabled ? 'on' : 'off'}</span>
}

describe('useFeatureFlag', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns enabled state for a known feature', async () => {
    const service = new Toggly({
      featureDefaults: { Enabled: true, Disabled: false },
    })

    render(
      <Provider value={{ toggly: service }}>
        <FlagProbe featureKey="Enabled" />
      </Provider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('on')
    })
  })

  it('updates when local gates change', async () => {
    let gateEnabled = false
    const service = new Toggly({
      featureDefaults: { Sales: true },
      localGates: [
        {
          id: 'sales',
          flagKeys: ['Sales'],
          isEnabled: () => gateEnabled,
        },
      ],
    })

    render(
      <Provider value={{ toggly: service }}>
        <FlagProbe featureKey="Sales" />
      </Provider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('off')
    })

    gateEnabled = true
    await act(async () => {
      service.notifyLocalGatesChanged()
      await new Promise((r) => setTimeout(r, 0))
    })

    await waitFor(() => {
      expect(screen.getByTestId('state')).toHaveTextContent('on')
    })
  })
})

describe('useFeatureGate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('evaluates all requirement', async () => {
    const service = new Toggly({
      featureDefaults: { A: true, B: true, C: false },
    })

    render(
      <Provider value={{ toggly: service }}>
        <GateProbe featureKeys={['A', 'B']} />
      </Provider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('gate')).toHaveTextContent('on')
    })
  })

  it('returns default when toggly is unavailable', () => {
    render(<FlagProbe featureKey="Enabled" />)

    expect(screen.getByTestId('state')).toHaveTextContent('off')
  })

  it('handles negate option', async () => {
    function NegateProbe() {
      const { isEnabled, isLoading } = useFeatureGate(['Enabled'], { negate: true })
      return (
        <span data-testid="negate">
          {isLoading ? 'loading' : isEnabled ? 'on' : 'off'}
        </span>
      )
    }

    const service = new Toggly({ featureDefaults: { Enabled: true } })
    render(
      <Provider value={{ toggly: service }}>
        <NegateProbe />
      </Provider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('negate')).toHaveTextContent('off')
    })
  })

  it('handles empty feature key list', async () => {
    function EmptyProbe() {
      const { isEnabled } = useFeatureGate([])
      return <span data-testid="empty">{isEnabled ? 'on' : 'off'}</span>
    }

    const service = new Toggly({ featureDefaults: {} })
    render(
      <Provider value={{ toggly: service }}>
        <EmptyProbe />
      </Provider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('empty')).toHaveTextContent('on')
    })
  })

  it('uses defaultValue when evaluation throws', async () => {
    const service = new Toggly({ featureDefaults: { Enabled: true } })
    jest.spyOn(service, 'evaluateFeatureGate').mockRejectedValue(new Error('boom'))

    function ErrorProbe() {
      const { isEnabled, isLoading } = useFeatureFlag('Enabled', { defaultValue: false })
      return (
        <span data-testid="error">
          {isLoading ? 'loading' : isEnabled ? 'on' : 'off'}
        </span>
      )
    }

    render(
      <Provider value={{ toggly: service }}>
        <ErrorProbe />
      </Provider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('off')
    })
  })

  it('refresh re-evaluates the gate', async () => {
    let gateEnabled = false
    const service = new Toggly({
      featureDefaults: { Sales: true },
      localGates: [
        {
          id: 'sales',
          flagKeys: ['Sales'],
          isEnabled: () => gateEnabled,
        },
      ],
    })

    function RefreshProbe() {
      const { isEnabled, refresh } = useFeatureFlag('Sales')
      return (
        <>
          <span data-testid="refresh">{isEnabled ? 'on' : 'off'}</span>
          <button type="button" onClick={() => void refresh()}>
            refresh
          </button>
        </>
      )
    }

    render(
      <Provider value={{ toggly: service }}>
        <RefreshProbe />
      </Provider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('refresh')).toHaveTextContent('off')
    })

    gateEnabled = true
    await act(async () => {
      screen.getByText('refresh').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('refresh')).toHaveTextContent('on')
    })
  })
})
