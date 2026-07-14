import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { Provider } from '../contexts/toggly.context'
import { Toggly } from '../services'
import { useVariant } from './useVariant'

const mockFetch = jest.fn()
;(global as any).fetch = mockFetch

function Probe({ featureKey }: { featureKey: string }) {
  const v = useVariant(featureKey)
  return <span data-testid="name">{v?.name ?? 'none'}</span>
}

describe('useVariant', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns null without provider service', () => {
    render(<Probe featureKey="F" />)
    expect(screen.getByTestId('name')).toHaveTextContent('none')
  })

  it('returns variant after load and updates on refresh', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: {
              F: { enabled: true, variant: 'control' },
            },
          }),
        text: () => Promise.resolve(JSON.stringify({
            defs: {
              F: { enabled: true, variant: 'control' },
            },
          })),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          Promise.resolve({
            defs: {
              F: { enabled: true, variant: 'treatment' },
            },
          }),
        text: () => Promise.resolve(JSON.stringify({
            defs: {
              F: { enabled: true, variant: 'treatment' },
            },
          })),
      })

    const toggly = new Toggly({
      appKey: 'k',
      environment: 'Production',
      enableVariants: true,
      enableLiveUpdates: false,
    })

    await toggly._loadFeatures()

    render(
      <Provider value={{ toggly }}>
        <Probe featureKey="F" />
      </Provider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('name')).toHaveTextContent('control')
    })

    await act(async () => {
      await (toggly as any)._refreshFeatures()
    })

    await waitFor(() => {
      expect(screen.getByTestId('name')).toHaveTextContent('treatment')
    })
  })
})
