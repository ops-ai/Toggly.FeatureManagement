import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { TogglyProvider, useToggly } from '../src/context'
import { useFeatureFlag, useFeatureGate } from '../src/hooks'
import { Feature, FeatureVariant, FeatureSwitch } from '../src/components'

const settle = async () => {for (let i = 0; i < 20; i++) await Promise.resolve()}
let context: ReturnType<typeof useToggly>
function Probe() {context = useToggly(); const flag = useFeatureFlag('On'); return <span data-testid="flag">{flag.isEnabled ? 'on' : 'off'}</span>}
const baseConfig = {appKey: 'browser', environment: 'Test', identity: 'owner', refreshInterval: 0, enableLiveUpdates: false, persistIdentity: false}

describe('Next browser provider telemetry', () => {
  let definitions: Record<string, unknown>
  let sent: any[]
  beforeEach(() => {
    sent = []; definitions = {On: true, Off: false}
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/frontend/telemetry')) {sent.push(JSON.parse(init!.body as string)); return {status: 202}}
      return {ok: true, status: 200, json: async () => ({defs: definitions})}
    }))
  })
  afterEach(async () => {cleanup(); await settle(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
  it.each(['enabled', 'storage-key'])('uses current identity persistence settings after a same-owner %s update', async changed => {
    const firstKey = 'oracle-identity-first'
    const secondKey = 'oracle-identity-second'
    localStorage.removeItem(firstKey); localStorage.removeItem(secondKey)
    const view = render(<TogglyProvider config={{...baseConfig,persistIdentity:changed==='storage-key',identityStorageKey:firstKey}} autoInit={false}><Probe/></TogglyProvider>)
    await act(settle)
    const owner = context.client
    view.rerender(<TogglyProvider config={{...baseConfig,persistIdentity:true,identityStorageKey:changed==='storage-key'?secondKey:firstKey}} autoInit={false}><Probe/></TogglyProvider>)
    await act(async () => {await context.init()})
    expect(context.client).toBe(owner)
    expect(localStorage.getItem(changed==='storage-key'?secondKey:firstKey)).toBe('owner')
    if (changed==='storage-key') expect(localStorage.getItem(firstKey)).toBeNull()
    localStorage.removeItem(firstKey); localStorage.removeItem(secondKey)
  })
  it('shares a typed compact companion and counts hook/component effective evaluations once', async () => {
    function Gate() {const result = useFeatureGate(['Off', 'On'], 'all', true); return <span data-testid="gate">{String(result.isAllowed)}</span>}
    render(<TogglyProvider config={baseConfig}><Probe/><Gate/><Feature featureKey="On"><span>visible</span></Feature><FeatureVariant featureKey="On" enabled="variant-on" disabled="variant-off"/><FeatureSwitch featureKey="On" cases={{on: 'switch-on', off: 'switch-off'}}/></TogglyProvider>)
    await waitFor(() => expect(context.isReady).toBe(true)); await act(settle)
    expect(screen.getByTestId('flag').textContent).toBe('on'); expect(screen.getByText('visible')).toBeTruthy()
    await context.client.flushTelemetry()
    expect(sent).toEqual([{k: 'browser', e: 'Test', u: 'owner', f: {On: {enabled: [4]}, Off: {disabled: [1]}}}])
    expect((context as any).telemetry).toBe(context.client.telemetry)
    sent.length = 0
    ;(context as any).telemetry.recordUsage('On', 'control'); (context as any).telemetry.setGauge('cart', 3)
    await (context as any).telemetry.flushTelemetry()
    expect(sent).toEqual([{k: 'browser', e: 'Test', u: 'owner', f: {On: {control: [0, 1]}}, m: {cart: 3}}])
  })
  it('counts cached pre-init UI evaluation after local gates and reacts without fetching', async () => {
    let enabled = false
    render(<TogglyProvider config={{...baseConfig, localGates: [{id: 'device', flagKeys: ['On'], isEnabled: () => enabled}]}} initialFeatures={{On: true}} autoInit={false}><Probe/></TogglyProvider>)
    await act(settle); expect(screen.getByTestId('flag').textContent).toBe('off')
    await context.client.flushTelemetry(); expect(sent[0].f).toEqual({On: {disabled: [1]}})
    sent.length = 0; enabled = true
    await act(async () => {context.client.notifyLocalGatesChanged(); await settle()})
    expect(screen.getByTestId('flag').textContent).toBe('on'); await context.client.flushTelemetry(); expect(sent[0].f).toEqual({On: {enabled: [1]}})
  })
  it('replaces app/environment owners without relabeling retained opposite-value snapshots', async () => {
    const view = render(<TogglyProvider config={{...baseConfig, appKey: 'old', environment: 'Old'}}><Probe/></TogglyProvider>)
    await waitFor(() => expect(context.isReady).toBe(true)); await act(settle)
    const first = context.client; await first.flushTelemetry(); sent.length = 0
    definitions = {On: false}
    view.rerender(<TogglyProvider config={{...baseConfig, appKey: 'new', environment: 'New'}}><Probe/></TogglyProvider>)
    await waitFor(() => expect(context.client.config.appKey).toBe('new')); await act(settle)
    await context.client.flushTelemetry()
    expect(screen.getByTestId('flag').textContent).toBe('off')
    expect(sent).toEqual([{k: 'new', e: 'New', u: 'owner', f: {On: {disabled: [1]}}}])
    first.recordUsage('On'); await first.flushTelemetry(); expect(sent).toHaveLength(1)
  })
  it('StrictMode replay keeps the mounted owner alive and genuine remount creates a new owner', async () => {
    const view = render(<StrictMode><TogglyProvider config={baseConfig}><Probe/></TogglyProvider></StrictMode>)
    await waitFor(() => expect(context.isReady).toBe(true)); await act(settle)
    const first = context.client; await first.flushTelemetry(); sent.length = 0
    first.recordUsage('On'); view.unmount(); await settle(); expect(sent[0].f).toEqual({On: {enabled: [0, 1]}})
    render(<TogglyProvider config={baseConfig}><Probe/></TogglyProvider>)
    await waitFor(() => expect(context.isReady).toBe(true)); await act(settle)
    expect(context.client).not.toBe(first); await context.client.flushTelemetry(); expect(sent[1].f).toEqual({On: {enabled: [1]}})
  })
})
