import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeFastifyToggly,
  featureGate,
  togglyPlugin,
} from '../src/plugin'

/**
 * Contract tests: real local HTTP matching definitions-signed response shapes,
 * then catalog-local evaluation through Fastify togglyPlugin / featureGate.
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

describe('Fastify definitions-signed API contract evaluation', () => {
  beforeEach(() => {
    closeFastifyToggly()
  })

  afterEach(() => {
    closeFastifyToggly()
  })

  it('evaluates flags through togglyPlugin from a bare definitions array', async () => {
    const definitions = await listenDefinitions(() => JSON.stringify(DEFINITIONS))
    const app = Fastify()
    try {
      await app.register(togglyPlugin, {
        appKey: 'contract-app',
        baseUrl: definitions.baseUrl,
        environment: 'Production',
        enableStreaming: false,
        enableUsageTracking: false,
        enableMetrics: false,
        refreshInterval: 0,
        registerContextsOnStartup: false,
      })
      app.get('/check', async (request) => ({
        alwaysOn: await request.toggly!.isFeatureOn('always-on'),
        alwaysOff: await request.toggly!.isFeatureOn('always-off'),
        beta: await request.toggly!.isFeatureOn('beta'),
        pctFull: await request.toggly!.isFeatureOn('pct-full'),
        missing: await request.toggly!.isFeatureOn('missing'),
        identity: request.toggly!.identity,
      }))
      app.get(
        '/gated-on',
        { preHandler: featureGate({ featureKey: 'always-on' }) },
        async () => ({ ok: true }),
      )
      app.get(
        '/gated-off',
        { preHandler: featureGate({ featureKey: 'always-off' }) },
        async () => ({ ok: true }),
      )
      app.get(
        '/gated-beta',
        { preHandler: featureGate({ featureKey: 'beta' }) },
        async () => ({ ok: true }),
      )

      const bob = await app.inject({
        method: 'GET',
        url: '/check',
        headers: { 'x-toggly-identity': 'bob' },
      })
      expect(definitions.lastUrl()).toBe('/definitions-signed/contract-app/Production')
      expect(bob.json()).toEqual({
        alwaysOn: true,
        alwaysOff: false,
        beta: false,
        pctFull: true,
        missing: false,
        identity: 'bob',
      })

      const alice = await app.inject({
        method: 'GET',
        url: '/check',
        headers: { 'x-toggly-identity': 'alice' },
      })
      expect(alice.json().beta).toBe(true)

      expect((await app.inject({ method: 'GET', url: '/gated-on' })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/gated-off' })).statusCode).toBe(404)
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/gated-beta',
            headers: { 'x-toggly-identity': 'alice' },
          })
        ).statusCode,
      ).toBe(200)
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/gated-beta',
            headers: { 'x-toggly-identity': 'bob' },
          })
        ).statusCode,
      ).toBe(404)
    } finally {
      await app.close()
      await definitions.close()
    }
  })

  it('evaluates flags from an unsigned { defs } envelope through featureGate', async () => {
    const definitions = await listenDefinitions(() =>
      JSON.stringify({ defs: DEFINITIONS }),
    )
    const app = Fastify()
    try {
      await app.register(togglyPlugin, {
        appKey: 'contract-app',
        baseUrl: definitions.baseUrl,
        environment: 'Staging',
        enableStreaming: false,
        enableUsageTracking: false,
        enableMetrics: false,
        refreshInterval: 0,
        registerContextsOnStartup: false,
      })
      app.get(
        '/gated-on',
        { preHandler: featureGate({ featureKey: 'always-on' }) },
        async () => ({ ok: true }),
      )
      app.get(
        '/gated-pct',
        { preHandler: featureGate({ featureKey: 'pct-full' }) },
        async () => ({ ok: true }),
      )

      expect((await app.inject({ method: 'GET', url: '/gated-on' })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/gated-pct' })).statusCode).toBe(200)
      expect(definitions.lastUrl()).toBe('/definitions-signed/contract-app/Staging')
    } finally {
      await app.close()
      await definitions.close()
    }
  })
})
