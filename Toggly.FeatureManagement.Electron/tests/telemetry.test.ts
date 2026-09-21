import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  ElectronTogglyClient,
  initToggly,
  closeToggly,
  getToggly,
} from '../src/main/client.js'
import { registerTogglyIpc } from '../src/main/ipc.js'
import { IPC_CHANNELS } from '../src/ipc-channels.js'

let directory: string
const clients: ElectronTogglyClient[] = []
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'electron-telemetry-'))
})
afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  closeToggly()
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true })
})
function transport() {
  const packets: any[] = []
  const requests: any[] = []
  return {
    packets,
    requests,
    fetch: async (url: string, init: any) => {
      requests.push({ url, ...init })
      packets.push(
        JSON.parse(
          typeof init.body === 'string'
            ? init.body
            : gunzipSync(Buffer.from(init.body)).toString(),
        ),
      )
      return { status: 202 }
    },
  }
}
async function owner(extra: any = {}) {
  const wire = transport()
  const client = new ElectronTogglyClient({
    userDataPath: directory,
    appKey: 'app',
    environment: 'Test',
    enableLiveUpdates: false,
    identity: 'secret',
    groups: ['private'],
    claims: { plan: 'private' },
    fetch: async () =>
      new Response(
        JSON.stringify({
          defs: {
            On: true,
            Off: false,
            Entity: {
              requirement: 'all',
              rules: [{ property: 'color', op: 'eq', value: 'red' }],
            },
          },
        }),
      ),
    telemetryFetch: wire.fetch,
    ...extra,
  })
  clients.push(client)
  await client.init()
  return { client, ...wire }
}
it('records effective cached leaves once after gates and before negation, and keeps explicit events private', async () => {
  const { client, packets, requests } = await owner()
  client.getFlags()
  await client.refresh()
  await client.flushTelemetry()
  expect(packets).toEqual([])
  client.isFeatureOn('On')
  client.isFeatureOff('Off')
  client.evaluateFeatureGate(['On', 'Off'], 'any', true)
  client.evaluateFeatureGate(['Off', 'On'], 'all', true)
  client.setLocalGates([
    { id: 'device', flagKeys: ['On'], isEnabled: () => false },
  ])
  client.isFeatureOn('On')
  client.isFeatureOn('Entity')
  client.isFeatureOn('Entity', {
    kind: 'Order',
    key: '1',
    attributes: { color: 'red' },
  })
  client.recordUsage('Action')
  client.recordView('Panel', 'blue')
  client.incrementCounter('orders', 2)
  client.setGauge('cart', 3.5)
  await client.flushTelemetry()
  await Promise.resolve()
  expect(packets).toEqual([
    {
      k: 'app',
      e: 'Test',
      u: 'secret',
      f: {
        On: { enabled: [2], disabled: [1] },
        Off: { disabled: [2] },
        Entity: { disabled: [1], enabled: [1] },
        Action: { enabled: [0, 1] },
        Panel: { blue: [0, 0, 1] },
      },
      m: { orders: 2, cart: 3.5 },
    },
  ])
  expect(requests[0].headers['Content-Encoding']).toBe('gzip')
  expect(requests[0].credentials).toBe('omit')
  expect(
    Object.keys(requests[0].headers).map((k) => k.toLowerCase()),
  ).not.toContain('origin')
})
it('does not revive refresh timers or mutate snapshots when disposed initialization resolves late', async () => {
  let finish!: (r: Response) => void
  const wire = transport()
  const client = new ElectronTogglyClient({
    userDataPath: directory,
    appKey: 'late',
    telemetryFetch: wire.fetch,
    enableLiveUpdates: false,
    fetch: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  clients.push(client)
  const initialized = client.init()
  while (!finish) await new Promise((r) => setTimeout(r, 1))
  vi.useFakeTimers()
  client.close()
  finish(new Response(JSON.stringify({ defs: { Late: true } })))
  await initialized
  expect(client.getFlags()).toEqual({})
  expect(vi.getTimerCount()).toBe(0)
  client.recordUsage('Late')
  await client.flushTelemetry()
  expect(wire.packets).toEqual([])
})
it('validates IPC sender, main frame and compact arguments without losing accepted data', async () => {
  const wire = transport()
  await initToggly({
    userDataPath: directory,
    appKey: 'ipc',
    enableLiveUpdates: false,
    fetch: async () => new Response('{"defs":{"On":true}}'),
    telemetryFetch: wire.fetch,
  })
  const handlers = new Map<string, Function>()
  const sync = new Map<string, Function>()
  const wc = { send: () => {}, mainFrame: {}, isDestroyed: () => false }
  const event = {
    sender: wc,
    senderFrame: wc.mainFrame,
    returnValue: undefined as unknown,
  }
  const unregister = registerTogglyIpc(
    {
      on: (k, f) => {
        sync.set(k, f)
      },
      handle: (k, f) => {
        handlers.set(k, f)
      },
      removeHandler: (k) => {
        handlers.delete(k)
      },
      removeAllListeners: (k) => {
        sync.delete(k)
      },
    },
    () => [{ webContents: wc }],
  )
  sync.get(IPC_CHANNELS.isFeatureOn)!(event, 'On')
  expect(event.returnValue).toBe(true)
  sync.get(IPC_CHANNELS.recordUsage)!(event, 'Action', 'enabled')
  for (const invalid of [
    { ...event, sender: {} },
    { ...event, senderFrame: {} },
    {},
  ])
    sync.get(IPC_CHANNELS.recordUsage)!(invalid, 'Rejected', 'enabled')
  for (const args of [
    ['Bad', 'contains space'],
    ['X'.repeat(50000), 'enabled'],
    ['Bad', 'enabled', { appKey: 'evil' }],
  ])
    sync.get(IPC_CHANNELS.recordUsage)!(event, ...args)
  for (const value of [-1, 1.5, Infinity, 1000001, '2'])
    sync.get(IPC_CHANNELS.incrementCounter)!(event, 'orders', value)
  sync.get(IPC_CHANNELS.incrementCounter)!(event, 'orders', 2)
  await handlers.get(IPC_CHANNELS.flushTelemetry)!(event)
  expect(wire.packets).toEqual([
    {
      k: 'ipc',
      e: 'Production',
      u: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      f: { On: { enabled: [1] }, Action: { enabled: [0, 1] } },
      m: { orders: 2 },
    },
  ])
  unregister()
  expect(sync.size).toBe(0)
  expect(handlers.size).toBe(0)
})
it('keeps legacy IPC evaluation without a window list but rejects new telemetry there', async () => {
  const wire = transport()
  await initToggly({
    userDataPath: directory,
    appKey: 'legacy',
    enableLiveUpdates: false,
    fetch: async () => new Response('{"defs":{"On":true}}'),
    telemetryFetch: wire.fetch,
  })
  const handlers = new Map<string, Function>()
  const sync = new Map<string, Function>()
  registerTogglyIpc({
    on: (k, f) => {
      sync.set(k, f)
    },
    handle: (k, f) => {
      handlers.set(k, f)
    },
  })
  const event = { returnValue: undefined as unknown }
  sync.get(IPC_CHANNELS.isFeatureOn)!(event, 'On')
  expect(event.returnValue).toBe(true)
  expect(await handlers.get(IPC_CHANNELS.getFlags)!({})).toEqual({ On: true })
  sync.get(IPC_CHANNELS.recordUsage)!(event, 'Rejected')
  expect(() => handlers.get(IPC_CHANNELS.flushTelemetry)!({})).toThrow()
})
it('flushes native background and bounds final quit while removing lifecycle listeners', async () => {
  const { EventEmitter } = await import('node:events')
  const { attachTogglyLifecycle } = await import('../src/main/lifecycle.js')
  const wire = transport()
  await initToggly({
    userDataPath: directory,
    appKey: 'life',
    enableLiveUpdates: false,
    fetch: async () => new Response('{"defs":{"On":true}}'),
    telemetryFetch: wire.fetch,
  })
  const { getToggly } = await import('../src/main/client.js')
  const client = getToggly()!
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
  const power = new EventEmitter()
  attachTogglyLifecycle(app, power)
  client.recordUsage('Background')
  power.emit('suspend')
  await client.flushTelemetry()
  expect(wire.packets[0].f).toEqual({ Background: { enabled: [0, 1] } })
  client.recordView('Exit')
  const preventDefault = vi.fn()
  app.emit('before-quit', { preventDefault })
  await client.flushTelemetry()
  await new Promise((r) => setTimeout(r, 0))
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(app.quit).toHaveBeenCalledOnce()
  expect(wire.requests[1].keepalive).toBe(true)
  expect(wire.requests[1].headers['Content-Encoding']).toBeUndefined()
  expect(app.listenerCount('before-quit')).toBe(0)
  expect(power.listenerCount('suspend')).toBe(0)
  client.recordUsage('Late')
  await client.flushTelemetry()
  expect(wire.packets).toHaveLength(2)
})
it('notifies reactive evaluations only when definitions or local gates change', async () => {
  const { client, packets } = await owner()
  let evaluations = 0
  const unsubscribe = client.onEvaluationsChanged(() => {
    evaluations++
    client.isFeatureOn('On')
  })
  await client.refresh()
  expect(evaluations).toBe(0)
  client.setLocalGates([
    { id: 'device', flagKeys: ['On'], isEnabled: () => false },
  ])
  expect(evaluations).toBe(1)
  await client.flushTelemetry()
  expect(packets[0].f).toEqual({ On: { disabled: [1] } })
  unsubscribe()
  client.setLocalGates([])
  expect(evaluations).toBe(1)
})
const electronIpc = vi.hoisted(() => ({
  api: undefined as any,
  sync: new Map<string, Function>(),
  async: new Map<string, Function>(),
  listeners: new Map<string, Function>(),
  event: {} as any,
}))
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      electronIpc.api = api
    },
  },
  ipcRenderer: {
    sendSync: (channel: string, ...args: unknown[]) => {
      electronIpc.sync.get(channel)!(electronIpc.event, ...args)
      return electronIpc.event.returnValue
    },
    invoke: async (channel: string, ...args: unknown[]) =>
      electronIpc.async.get(channel)!(electronIpc.event, ...args),
    on: (channel: string, fn: Function) => {
      electronIpc.listeners.set(channel, fn)
    },
    removeListener: (channel: string) => {
      electronIpc.listeners.delete(channel)
    },
  },
}))
it('forwards public main, renderer and preload APIs through one real reporter and cleans subscriptions', async () => {
  const wire = transport()
  await initToggly({
    userDataPath: directory,
    appKey: 'bridge',
    enableLiveUpdates: false,
    fetch: async () => new Response('{"defs":{"On":true}}'),
    telemetryFetch: wire.fetch,
  })
  const wc = {
    mainFrame: {},
    send: (channel: string, ...args: unknown[]) =>
      electronIpc.listeners.get(channel)?.({}, ...args),
  }
  electronIpc.event = {
    sender: wc,
    senderFrame: wc.mainFrame,
    returnValue: undefined,
  }
  const unregister = registerTogglyIpc(
    {
      on: (key, fn) => {
        electronIpc.sync.set(key, fn)
      },
      handle: (key, fn) => {
        electronIpc.async.set(key, fn)
      },
    },
    () => [{ webContents: wc }],
  )
  const { exposeToggly } = await import('../src/preload/index.js')
  exposeToggly()
  vi.stubGlobal('window', { toggly: electronIpc.api })
  const renderer = await import('../src/renderer/index.js')
  const main = await import('../src/main/client.js')
  renderer.recordUsage('Action')
  renderer.recordView('Panel')
  renderer.incrementCounter('orders')
  renderer.setGauge('cart', 2)
  main.recordUsage('Action', 'blue')
  main.recordView('Panel', 'blue')
  main.incrementCounter('orders', 2)
  main.setGauge('cart', 3)
  let changed = 0
  const detach = renderer.onEvaluationsChanged(() => {
    changed++
    renderer.isFeatureOn('On')
  })
  main
    .getToggly()!
    .setLocalGates([{ id: 'x', flagKeys: ['On'], isEnabled: () => false }])
  expect(changed).toBe(1)
  detach()
  main.getToggly()!.setLocalGates([])
  expect(changed).toBe(1)
  await renderer.flushTelemetry()
  await main.flushTelemetry()
  expect(wire.packets).toEqual([
    {
      k: 'bridge',
      e: 'Production',
      u: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      f: {
        Action: { enabled: [0, 1], blue: [0, 1] },
        Panel: { enabled: [0, 0, 1], blue: [0, 0, 1] },
        On: { disabled: [1] },
      },
      m: { orders: 3, cart: 3 },
    },
  ])
  unregister()
  closeToggly()
  vi.stubGlobal('window', undefined)
  renderer.recordUsage('Absent')
  renderer.recordView('Absent')
  renderer.incrementCounter('absent')
  renderer.setGauge('absent', 1)
  renderer.onEvaluationsChanged(() => {})()
  await renderer.flushTelemetry()
  main.recordUsage('Absent')
  main.recordView('Absent')
  main.incrementCounter('absent')
  main.setGauge('absent', 1)
  await main.flushTelemetry()
  vi.unstubAllGlobals()
  expect(wire.packets).toHaveLength(1)
})
it('keeps disabled and keyless telemetry silent, and bounds a stalled native quit to five seconds', async () => {
  for (const options of [{ enableTelemetry: false }, { appKey: '' }]) {
    const { client, packets } = await owner(options)
    client.isFeatureOn('On')
    client.recordUsage('Action')
    await client.flushTelemetry()
    client.close()
    expect(packets).toEqual([])
  }
  const { EventEmitter } = await import('node:events')
  const { attachTogglyLifecycle } = await import('../src/main/lifecycle.js')
  expect(() =>
    attachTogglyLifecycle(Object.assign(new EventEmitter(), { quit() {} })),
  ).toThrow(/not initialized/)
  await initToggly({
    userDataPath: directory,
    appKey: 'stalled',
    enableLiveUpdates: false,
    fetch: async () => new Response('{"defs":{}}'),
    telemetryFetch: () => new Promise(() => {}),
  })
  const main = await import('../src/main/client.js')
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
  attachTogglyLifecycle(app)
  vi.useFakeTimers()
  main.recordUsage('Exit')
  app.emit('before-quit', { preventDefault() {} })
  await vi.advanceTimersByTimeAsync(5000)
  expect(app.quit).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
it('reinitialization detaches IPC/lifecycle, preserves delivered checks and cancels the old queue', async () => {
  const wire = transport()
  const main = await import('../src/main/client.js')
  const { EventEmitter } = await import('node:events')
  const { attachTogglyLifecycle } = await import('../src/main/lifecycle.js')
  const first = {
    userDataPath: directory,
    appKey: 'old',
    environment: 'Old',
    enableLiveUpdates: false,
    fetch: async () => new Response('{"defs":{"Switch":true}}'),
    telemetryFetch: wire.fetch,
  }
  await initToggly(first)
  const old = main.getToggly()!
  old.isFeatureOn('Switch')
  await old.flushTelemetry()
  old.recordUsage('Cancelled')
  const sync = new Map<string, Function>(),
    async = new Map<string, Function>()
  const ipc = {
    on: (k: string, f: Function) => {
      sync.set(k, f)
    },
    handle: (k: string, f: Function) => {
      async.set(k, f)
    },
    removeAllListeners: (k: string) => {
      sync.delete(k)
    },
    removeHandler: (k: string) => {
      async.delete(k)
    },
  }
  const unregister = registerTogglyIpc(ipc)
  const app = Object.assign(new EventEmitter(), { quit() {} })
  attachTogglyLifecycle(app)
  await initToggly({
    ...first,
    appKey: 'new',
    environment: 'New',
    fetch: async () => new Response('{"defs":{"Switch":false}}'),
  })
  expect(sync.size).toBe(0)
  expect(async.size).toBe(0)
  expect(app.listenerCount('before-quit')).toBe(0)
  main.isFeatureOn('Switch')
  await old.flushTelemetry()
  await main.flushTelemetry()
  expect(wire.packets).toEqual([
    { k: 'old', e: 'Old', u: expect.stringMatching(/^[0-9a-f-]{36}$/), f: { Switch: { enabled: [1] } } },
    { k: 'new', e: 'New', u: expect.stringMatching(/^[0-9a-f-]{36}$/), f: { Switch: { disabled: [1] } } },
  ])
  registerTogglyIpc(ipc)
  unregister()
  expect(sync.size).toBeGreaterThan(0)
})
it('invalidates an existing renderer when a replacement owner registers its IPC', async () => {
  const wire=transport();const main=await import('../src/main/client.js')
  await initToggly({userDataPath:directory,appKey:'new',environment:'New',enableLiveUpdates:false,fetch:async()=>new Response('{"defs":{"Switch":false}}'),telemetryFetch:wire.fetch})
  let rendered=true
  const sync=new Map<string,Function>()
  const window={webContents:{send:(channel:string)=>{if(channel===IPC_CHANNELS.evaluationsChanged){const event={returnValue:undefined as unknown};sync.get(IPC_CHANNELS.isFeatureOn)!(event,'Switch');rendered=event.returnValue as boolean}}}}
  registerTogglyIpc({on:(key,fn)=>{sync.set(key,fn)},handle:()=>{}},()=>[window])
  expect(rendered).toBe(false);await main.flushTelemetry();expect(wire.packets[0]).toEqual({k:'new',e:'New',u:expect.stringMatching(/^[0-9a-f-]{36}$/),f:{Switch:{disabled:[1]}}})
})

it('preserves the newest singleton and accepted event after finite diagnostic reentry', async () => {
  const wire=transport();const reads:string[]=[];let replacement:Promise<unknown>|undefined
  const base={userDataPath:directory,appKey:'app',enableLiveUpdates:false,fetch:async(url:any)=>{reads.push(String(url));return new Response('{"On":true}')},telemetryFetch:wire.fetch}
  await initToggly({...base,identity:'alice',telemetryFlushIntervalMs:1,onTelemetryDiagnostic:()=>{
    replacement=initToggly({...base,identity:'bob'})
    getToggly()!.recordUsage('Accepted')
  }})
  await replacement;await getToggly()!.flushTelemetry()
  expect(reads).toHaveLength(1);expect(new URL(reads[0]).searchParams.get('u')).toBe('bob')
  expect(wire.packets).toEqual([{k:'app',e:'Production',u:'bob',f:{Accepted:{enabled:[0,1]}}}])
})
it('keeps terminal singleton disposal authoritative during constructor diagnostics', async () => {
  await initToggly({userDataPath:directory,appKey:'app',enableLiveUpdates:false,telemetryFlushIntervalMs:1,onTelemetryDiagnostic:closeToggly,fetch:async()=>new Response('{"On":true}')})
  expect(getToggly()).toBeNull()
})

it('shares one bounded admission budget across2200 context transitions', async()=>{
 const {client,packets}=await owner({fetch:async()=>{throw new Error('offline')}})
 for(let n=0;n<2200;n++){await client.setContext({instanceId:'i'+n});client.recordUsage('Action')}
 await client.flushTelemetry()
 expect(packets).toHaveLength(2000)
 expect(packets.reduce((total,packet)=>total+packet.f.Action.enabled[1],0)).toBe(2000)
 expect(packets.every((packet,n)=>packet.i==='i'+n&&packet.u===undefined)).toBe(true)
 expect(packets.reduce((total,packet)=>total+Buffer.byteLength(JSON.stringify(packet)),0)).toBeLessThanOrEqual(256*1024)
},15000)
