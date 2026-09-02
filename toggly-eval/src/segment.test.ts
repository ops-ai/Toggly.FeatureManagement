import { describe, expect, it, vi } from 'vitest'
import { evaluateDefinition, computePercentile, type FeatureDefinitionModel } from './index'
import { passesSegmentPercentageGate } from './segment'

const chromeUA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

describe('segment filters', () => {
  it('BrowserFamily matches UA with sticky % when identity present', () => {
    const featureKey = 'seg-browser'
    const identity = 'user-123'
    const bucket = computePercentile(identity, featureKey)
    const def: FeatureDefinitionModel = {
      featureKey,
      filters: [
        {
          name: 'BrowserFamily',
          parameters: {
            Percentage: bucket + 1,
            'BrowserFamily:0': 'Chrome',
          },
        },
      ],
    }
    expect(
      evaluateDefinition(def, {
        identity,
        request: { userAgent: chromeUA },
      }),
    ).toBe(true)
    expect(
      evaluateDefinition(def, {
        identity,
        request: { userAgent: chromeUA },
      }),
    ).toBe(true)

    const below: FeatureDefinitionModel = {
      featureKey,
      filters: [
        {
          name: 'BrowserFamily',
          parameters: {
            Percentage: Math.max(0, bucket - 1),
            'BrowserFamily:0': 'Chrome',
          },
        },
      ],
    }
    expect(
      evaluateDefinition(below, {
        identity,
        request: { userAgent: chromeUA },
      }),
    ).toBe(false)
  })

  it('BrowserLanguage / Country / OS / DeviceType / UserClaims', () => {
    expect(
      evaluateDefinition(
        {
          featureKey: 'lang',
          filters: [
            {
              name: 'BrowserLanguage',
              parameters: {
                Percentage: 100,
                'BrowserLanguage:0': 'en-US',
              },
            },
          ],
        },
        {
          identity: 'u',
          request: { acceptLanguage: 'en-US,en;q=0.9' },
        },
      ),
    ).toBe(true)

    expect(
      evaluateDefinition(
        {
          featureKey: 'country',
          filters: [
            {
              name: 'Country',
              parameters: { Percentage: 100, 'Country:0': 'US' },
            },
          ],
        },
        { identity: 'u', request: { country: 'us' } },
      ),
    ).toBe(true)

    expect(
      evaluateDefinition(
        {
          featureKey: 'os',
          filters: [
            {
              name: 'OS',
              parameters: {
                Percentage: 100,
                'OperatingSystem:0': 'Mac',
              },
            },
          ],
        },
        { identity: 'u', request: { userAgent: chromeUA } },
      ),
    ).toBe(true)

    const iphoneUA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(
      evaluateDefinition(
        {
          featureKey: 'device',
          filters: [
            {
              name: 'DeviceType',
              parameters: {
                Percentage: 100,
                'DeviceType:0': 'iPhone',
              },
            },
          ],
        },
        { identity: 'u', request: { userAgent: iphoneUA } },
      ),
    ).toBe(true)

    expect(
      evaluateDefinition(
        {
          featureKey: 'claims',
          filters: [
            {
              name: 'UserClaims',
              parameters: {
                Percentage: 100,
                Claim: 'role',
                Value: 'admin',
              },
            },
          ],
        },
        { identity: 'u', claims: { role: 'admin' } },
      ),
    ).toBe(true)
    expect(
      evaluateDefinition(
        {
          featureKey: 'claims',
          filters: [
            {
              name: 'UserClaims',
              parameters: {
                Percentage: 100,
                Claim: 'role',
                Value: 'admin',
              },
            },
          ],
        },
        { identity: 'u', claims: { role: 'user' } },
      ),
    ).toBe(false)
  })

  it('CountryFamily alias works', () => {
    expect(
      evaluateDefinition(
        {
          featureKey: 'c',
          filters: [
            {
              name: 'CountryFamily',
              parameters: { Percentage: 100, 'Country:0': 'DE' },
            },
          ],
        },
        { identity: 'u', request: { country: 'DE' } },
      ),
    ).toBe(true)
  })

  it('passesSegmentPercentageGate uses random without identity', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.1)
    try {
      expect(passesSegmentPercentageGate(50, 'f')).toBe(true)
      expect(passesSegmentPercentageGate(5, 'f')).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})
