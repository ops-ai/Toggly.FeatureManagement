import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeKoaToggly,
  featureGate,
  togglyMiddleware,
} from '../src/middleware'

/**
 * Contract tests: real local HTTP matching definitions-signed response shapes,
 * then catalog-local evaluation through Koa togglyMiddleware / featureGate.
 * Mock only the definitions transport — not the evaluator.
 */

const DEFINITIONS = [
  { featureKey: 'always-on', filters: [{ name: 'AlwaysOn', parameters: {} }] },
  { featureKey: 'always-off', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  {
    featureKey: 'beta',
    filters: [
      {
        name: 'Targeting',
        parameters: {
          'Audience.Users:0': 'alice',
          'Audience.DefaultRolloutPercentage': 0,
        },
      },
    ],
  },
  {
    featureKey: 'pct-full',
    filters: [{ name: 'Percentage', parameters: { Value: 100 } }],
  },
]

async function listenDefinitions(
  bodyFactory: () => string,
): Promise<{ baseUrl: string; close: () => Promise<void>; lastUrl: () => string | undefined }> {
  let lastUrl: string | undefined
  const server = createServer((request, response) => {
    lastUrl = request.url
    response.writeHead(200, { 'content-type': 'application/json', etag: '"contract-rev-1"' })
    response.end(bodyFactory())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    lastUrl: () => lastUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function listenApp(app: Koa): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  const host = createServer(app.callback())
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve))
  const { port } = host.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        host.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function mountContractRoutes(app: Koa) {
  app.use(async (ctx, next) => {
    if (ctx.path === '/check') {
      const toggly = ctx.state.toggly!
      ctx.body = {
        alwaysOn: await toggly.isFeatureOn('always-on'),
        alwaysOff: await toggly.isFeatureOn('always-off'),
        beta: await toggly.isFeatureOn('beta'),
        pctFull: await toggly.isFeatureOn('pct-full'),
        missing: await toggly.isFeatureOn('missing'),
        identity: toggly.identity,
      }
      return
    }
    await next()
  })

  const gateOn = featureGate({ featureKey: 'always-on' })
  const gateOff = featureGate({ featureKey: 'always-off' })
  const gateBeta = featureGate({ featureKey: 'beta' })
  const gatePct = featureGate({ featureKey: 'pct-full' })

  app.use(async (ctx, next) => {
    if (ctx.path === '/gated-on') {
      await gateOn(ctx, async () => {
        ctx.body = { ok: true }
      })
      return
    }
    if (ctx.path === '/gated-off') {
      await gateOff(ctx, async () => {
        ctx.body = { ok: true }
      })
      return
    }
    if (ctx.path === '/gated-beta') {
      await gateBeta(ctx, async () => {
        ctx.body = { ok: true }
      })
      return
    }
    if (ctx.path === '/gated-pct') {
      await gatePct(ctx, async () => {
        ctx.body = { ok: true }
      })
      return
    }
    await next()
  })
}

describe('Koa definitions-signed API contract evaluation', () => {
  beforeEach(() => {
    closeKoaToggly()
  })

  afterEach(() => {
    closeKoaToggly()
  })

  it('evaluates flags through togglyMiddleware from a bare definitions array', async () => {
    const definitions = await listenDefinitions(() => JSON.stringify(DEFINITIONS))
    try {
      const app = new Koa()
      app.use(
        togglyMiddleware({
          appKey: 'contract-app',
          baseUrl: definitions.baseUrl,
          environment: 'Production',
          enableStreaming: false,
          enableUsageTracking: false,
          enableMetrics: false,
          refreshInterval: 0,
          registerContextsOnStartup: false,
        }),
      )
      mountContractRoutes(app)

      const host = await listenApp(app)
      try {
        const bob = await (
          await fetch(`${host.origin}/check`, {
            headers: { 'x-toggly-identity': 'bob' },
          })
        ).json()
        expect(definitions.lastUrl()).toBe('/definitions-signed/contract-app/Production')
        expect(bob).toEqual({
          alwaysOn: true,
          alwaysOff: false,
          beta: false,
          pctFull: true,
          missing: false,
          identity: 'bob',
        })

        const alice = await (
          await fetch(`${host.origin}/check`, {
            headers: { 'x-toggly-identity': 'alice' },
          })
        ).json()
        expect(alice.beta).toBe(true)

        expect((await fetch(`${host.origin}/gated-on`)).status).toBe(200)
        expect((await fetch(`${host.origin}/gated-off`)).status).toBe(404)
        expect(
          (
            await fetch(`${host.origin}/gated-beta`, {
              headers: { 'x-toggly-identity': 'alice' },
            })
          ).status,
        ).toBe(200)
        expect(
          (
            await fetch(`${host.origin}/gated-beta`, {
              headers: { 'x-toggly-identity': 'bob' },
            })
          ).status,
        ).toBe(404)
      } finally {
        await host.close()
      }
    } finally {
      await definitions.close()
    }
  })

  it('evaluates flags from an unsigned { defs } envelope through featureGate', async () => {
    const definitions = await listenDefinitions(() =>
      JSON.stringify({ defs: DEFINITIONS }),
    )
    try {
      const app = new Koa()
      app.use(
        togglyMiddleware({
          appKey: 'contract-app',
          baseUrl: definitions.baseUrl,
          environment: 'Staging',
          enableStreaming: false,
          enableUsageTracking: false,
          enableMetrics: false,
          refreshInterval: 0,
          registerContextsOnStartup: false,
        }),
      )
      mountContractRoutes(app)

      const host = await listenApp(app)
      try {
        expect((await fetch(`${host.origin}/gated-on`)).status).toBe(200)
        expect((await fetch(`${host.origin}/gated-pct`)).status).toBe(200)
        expect(definitions.lastUrl()).toBe('/definitions-signed/contract-app/Staging')
      } finally {
        await host.close()
      }
    } finally {
      await definitions.close()
    }
  })
})
