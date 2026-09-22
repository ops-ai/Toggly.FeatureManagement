import {afterEach, expect, it, vi} from 'vitest'
import {createTogglyClient} from '../src/client'
const options = {appKey: 'context-update', identity: 'alice', groups: [] as string[], claims: {role: 'user'}, refreshInterval: 0, enableLiveUpdates: false, enableUsageTracking: false, enableMetrics: false}
const definitions = [{featureKey: 'Group', filters: [{name: 'Targeting', parameters: {'Audience.Groups:0': 'beta', 'Audience.DefaultRolloutPercentage': 0}}]}, {featureKey: 'Claim', filters: [{name: 'UserClaims', parameters: {Percentage: 100, Claim: 'role', Value: 'admin'}}]}]
afterEach(() => {vi.unstubAllGlobals()})
it.each([['local', false], ['local', true], ['remote', false], ['remote', true]] as const)('publishes coherent %s state with equal identity supplied=%s, without redundant hooks or no-op fetches', async (evaluationMode, equalIdentity) => {
  const fetcher = vi.fn(async (raw: any) => {
    const url = new URL(raw)
    return new Response(JSON.stringify(evaluationMode === 'local' ? definitions : {Group: url.searchParams.getAll('g').includes('beta'), Claim: url.searchParams.get('claim.role') === 'admin'}))
  })
  vi.stubGlobal('fetch', fetcher)
  const beforeIdentify = vi.fn(), afterIdentify = vi.fn()
  const client = createTogglyClient({...options, evaluationMode, hooks: [{getMetadata: () => ({name: 'identity'}), beforeIdentify, afterIdentify}]})
  try {
    await client.init(); let notifications = 0; client.subscribeFeaturesRefresh(() => {notifications++})
    await client.setContext({...(equalIdentity ? {identity: 'alice'} : {}), groups: ['beta', 'other']})
    expect(client.state.features).toEqual({Group: true, Claim: false}); expect(notifications).toBe(1)
    await client.setContext({...(equalIdentity ? {identity: 'alice'} : {}), claims: {role: 'admin', plan: 'paid'}})
    expect(await client.evaluateFeatureGate(['Group', 'Claim'])).toBe(true)
    expect(client.state.features).toEqual({Group: true, Claim: true}); expect(notifications).toBe(2)
    expect(beforeIdentify).not.toHaveBeenCalled(); expect(afterIdentify).not.toHaveBeenCalled()
    const requests = fetcher.mock.calls.length
    expect(requests).toBe(evaluationMode === 'local' ? 1 : 3)
    await client.setContext({identity: 'alice', groups: ['other', 'beta'], claims: {plan: 'paid', role: 'admin'}}); await client.setContext({})
    expect(fetcher).toHaveBeenCalledTimes(requests); expect(notifications).toBe(2)
    await client.setContext({groups: [], claims: {role: 'user'}})
    expect(await client.evaluateFeatureGate(['Group', 'Claim'])).toBe(false)
    expect(client.state.features).toEqual({Group: false, Claim: false}); expect(notifications).toBe(3)
    const beforeIdentityRequests = fetcher.mock.calls.length
    await client.setContext({identity: 'bob', groups: ['beta'], claims: {role: 'admin'}})
    expect(client.identity).toBe('bob'); expect(await client.evaluateFeatureGate(['Group', 'Claim'])).toBe(true)
    expect(beforeIdentify).toHaveBeenCalledTimes(1); expect(afterIdentify).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(beforeIdentityRequests + (evaluationMode === 'remote' ? 1 : 0))
  } finally {client.destroy()}
})

it('releases local-change subscribers when its owner is destroyed', () => {
  const client = createTogglyClient(options)
  let notifications = 0
  client.subscribeLocalGatesChanged(() => {notifications++})
  client.notifyLocalGatesChanged(); expect(notifications).toBe(1)
  client.destroy(); client.notifyLocalGatesChanged(); expect(notifications).toBe(1)
})
