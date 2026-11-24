import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeExpressToggly,
  featureGate,
  togglyMiddleware,
} from '../src/middleware'
import type { TogglyRequest } from '../src/types'

/**
 * Contract tests: real local HTTP matching definitions-signed response shapes,
 * then catalog-local evaluation through Express togglyMiddleware / featureGate.
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

async function listenApp(app: express.Express): Promise<{
  origin: string
  close: () => Promise<void>
}> {
  const host = createServer(app)
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

describe('Express definitions-signed API contract evaluation', () => {
  beforeEach(() => {
    closeExpressToggly()
  })

  afterEach(() => {
    closeExpressToggly()
  })

  it('evaluates flags through togglyMiddleware from a bare definitions array', async () => {
    const definitions = await listenDefinitions(() => JSON.stringify(DEFINITIONS))
    try {
      const app = express()
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
      app.get('/check', async (req, res) => {
        const toggly = (req as TogglyRequest).toggly!
        res.json({
          alwaysOn: await toggly.isFeatureOn('always-on'),
          alwaysOff: await toggly.isFeatureOn('always-off'),
          beta: await toggly.isFeatureOn('beta'),
          pctFull: await toggly.isFeatureOn('pct-full'),
          missing: await toggly.isFeatureOn('missing'),
          identity: toggly.identity,
        })
      })
      app.get('/gated-on', featureGate({ featureKey: 'always-on' }), (_req, res) => {
        res.json({ ok: true })
      })
      app.get('/gated-off', featureGate({ featureKey: 'always-off' }), (_req, res) => {
        res.json({ ok: true })
      })
      app.get('/gated-beta', featureGate({ featureKey: 'beta' }), (_req, res) => {
        res.json({ ok: true })
      })

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
      const app = express()
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
      app.get('/gated-on', featureGate({ featureKey: 'always-on' }), (_req, res) => {
        res.json({ ok: true })
      })
      app.get('/gated-pct', featureGate({ featureKey: 'pct-full' }), (_req, res) => {
        res.json({ ok: true })
      })

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
