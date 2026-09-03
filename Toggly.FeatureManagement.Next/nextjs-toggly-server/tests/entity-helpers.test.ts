import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import type { FeatureDefinitionModel } from '@ops-ai/nextjs-toggly-core'
import {
  initServerToggly,
  isServerFeatureOn,
  isServerFeatureOff,
  resetServerToggly,
  useServerToggly,
} from '../src/server-client'
import {
  checkFeature,
  checkFeatureOff,
  checkFeatureGate,
  getFeatures,
  getFeatureStates,
  withFeature,
} from '../src/actions'
import { Feature, FeatureOff, FeatureVariant } from '../src/components'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const entityGated: FeatureDefinitionModel = {
  featureKey: 'EntityGated',
  requirementType: 'Any',
  contextRequirementType: 'All',
  filters: [
    {
      name: 'ContextProperty',
      parameters: {
        Property: 'BirthDate',
        Operator: 'gt',
        Value: '2026-01-01',
        ValueType: 'datetime',
      },
    },
    { name: 'AlwaysOn', parameters: {} },
  ],
}

const alwaysOn: FeatureDefinitionModel = {
  featureKey: 'AlwaysOnFlag',
  filters: [{ name: 'AlwaysOn', parameters: {} }],
}

const orderOn = {
  kind: 'Order',
  key: '1',
  attributes: { BirthDate: '2026-06-15T00:00:00Z' },
}

const orderOff = {
  kind: 'Order',
  key: '2',
  attributes: { BirthDate: '2020-01-01T00:00:00Z' },
}

function defsResponse(definitions: FeatureDefinitionModel[]) {
  const body = JSON.stringify(definitions)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
    json: async () => definitions,
    headers: { get: () => null },
  }
}

describe('entity context on server helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetServerToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetServerToggly()
    vi.restoreAllMocks()
  })

  async function initEntityClient() {
    mockFetch.mockResolvedValueOnce(defsResponse([entityGated, alwaysOn]))
    await initServerToggly({
      appKey: 'test-key',
      identity: 'bob',
      enableLiveUpdates: false,
    })
  }

  it('isServerFeatureOn evaluates entity gates without mutating identity', async () => {
    await initEntityClient()
    const shared = useServerToggly()

    await expect(isServerFeatureOn('EntityGated')).resolves.toBe(false)
    await expect(
      isServerFeatureOn('EntityGated', { context: orderOn })
    ).resolves.toBe(true)
    await expect(
      isServerFeatureOn('EntityGated', { context: orderOff })
    ).resolves.toBe(false)
    await expect(isServerFeatureOn('AlwaysOnFlag', 'alice')).resolves.toBe(true)
    expect(shared.identity).toBe('bob')
  })

  it('isServerFeatureOff inverts entity evaluation', async () => {
    await initEntityClient()
    await expect(
      isServerFeatureOff('EntityGated', { context: orderOn })
    ).resolves.toBe(false)
  })

  it('checkFeature and checkFeatureGate forward context', async () => {
    await initEntityClient()

    await expect(checkFeature('EntityGated')).resolves.toBe(false)
    await expect(
      checkFeature('EntityGated', { context: orderOn, contextKind: 'Order' })
    ).resolves.toBe(true)
    await expect(
      checkFeatureOff('EntityGated', { context: orderOn })
    ).resolves.toBe(false)

    const gate = await checkFeatureGate({
      featureKeys: 'EntityGated',
      context: orderOn,
    })
    expect(gate.allowed).toBe(true)
    expect(gate.error).toBeUndefined()
  })

  it('getFeatureStates applies the same entity context to each key', async () => {
    await initEntityClient()
    const states = await getFeatureStates(['EntityGated', 'AlwaysOnFlag'], {
      context: orderOn,
    })
    expect(states).toEqual({ EntityGated: true, AlwaysOnFlag: true })
  })

  it('Feature components pass context through', async () => {
    await initEntityClient()

    await expect(
      Feature({
        featureKey: 'EntityGated',
        context: orderOn,
        children: 'on',
        fallback: 'off',
      })
    ).resolves.toBe('on')

    await expect(
      Feature({
        featureKey: 'EntityGated',
        children: 'on',
        fallback: 'off',
      })
    ).resolves.toBe('off')

    await expect(
      FeatureOff({
        featureKey: 'EntityGated',
        context: orderOn,
        children: 'hidden',
        fallback: 'shown',
      })
    ).resolves.toBe('shown')

    await expect(
      FeatureVariant({
        featureKey: 'EntityGated',
        context: orderOff,
        enabled: 'new',
        disabled: 'old',
      })
    ).resolves.toBe('old')
  })

  it('Feature.Fallback nested child is equivalent to the fallback prop', async () => {
    await initEntityClient()

    await expect(
      Feature({
        featureKey: 'EntityGated',
        context: orderOn,
        children: ['on', React.createElement(Feature.Fallback, null, 'off')],
      })
    ).resolves.toBe('on')

    await expect(
      Feature({
        featureKey: 'EntityGated',
        children: ['on', React.createElement(Feature.Fallback, null, 'off')],
      })
    ).resolves.toBe('off')

    await expect(
      FeatureOff({
        featureKey: 'EntityGated',
        context: orderOn,
        children: [
          'hidden',
          React.createElement(FeatureOff.Fallback, null, 'shown'),
        ],
      })
    ).resolves.toBe('shown')

    await expect(
      Feature({
        featureKey: 'EntityGated',
        fallback: 'prop',
        children: [
          'on',
          React.createElement(Feature.Fallback, null, 'nested'),
        ],
      })
    ).resolves.toBe('prop')
  })

  it('checkFeature fails closed when the server client is missing', async () => {
    await expect(checkFeature('EntityGated', { context: orderOn })).resolves.toBe(
      false
    )
    const gate = await checkFeatureGate({
      featureKeys: 'EntityGated',
      context: orderOn,
    })
    expect(gate.allowed).toBe(false)
    expect(gate.error).toMatch(/not initialized/)
  })

  it('withFeature runs the action when the entity gate passes', async () => {
    await initEntityClient()
    const action = withFeature('EntityGated', async () => 'ok', {
      context: orderOn,
    })
    await expect(action()).resolves.toBe('ok')
  })

  it('withFeature uses onDisabled when the entity gate fails', async () => {
    await initEntityClient()
    const action = withFeature('EntityGated', async () => 'ok', {
      context: orderOff,
      onDisabled: async () => 'skipped',
    })
    await expect(action()).resolves.toBe('skipped')
  })

  it('getFeatures snapshots identity-scoped booleans without entity context', async () => {
    await initEntityClient()
    const features = await getFeatures()
    expect(features.AlwaysOnFlag).toBe(true)
    expect(features.EntityGated).toBe(false)
  })
})
