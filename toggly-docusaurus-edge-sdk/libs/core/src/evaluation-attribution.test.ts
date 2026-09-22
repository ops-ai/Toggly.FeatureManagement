import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { createTogglyClient } from './browser';
import type { TogglyClient, TogglyConfig } from './client';

const response = (flags: Record<string, unknown>) => new Response(JSON.stringify(flags));
const gate = { requirement: 'all', rules: [{ property: 'Plan', op: 'eq', value: 'pro', type: 'string' }] };
const clients: TogglyClient[] = [];
let packets: Record<string, any>[];
function makeClient(config: TogglyConfig = {}) {
  const client = createTogglyClient({
    appKey: 'attribution-app', identity: 'alice', featureFlagsRefreshInterval: 60_000,
    fetch: vi.fn(async url => response({ Feature: new URL(String(url)).searchParams.get('u') === 'bob' ? false : gate })),
    telemetryFetch: async (_url, init) => {
      const text = typeof init.body === 'string' ? init.body : gunzipSync(Buffer.from(init.body as Uint8Array)).toString();
      packets.push(JSON.parse(text)); return { status: 202 };
    },
    ...config,
  });
  clients.push(client); return client;
}
const expected = (identity: string, enabled: boolean) => ({ k: 'attribution-app', e: 'Production', u: identity, f: { Feature: { [enabled ? 'enabled' : 'disabled']: [1] } } });
beforeEach(() => {
  packets = [];
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' });
});
afterEach(() => { for (const client of clients.splice(0)) client.dispose({ flush: false }); vi.unstubAllGlobals(); });

describe('evaluation attribution snapshots with the public reporter', () => {
  it.each(['identity', 'instanceId'] as const)('keeps the captured owner through a reentrant mapper changing %s', async field => {
    const client = makeClient(field === 'instanceId' ? { instanceId: 'token-a' } : {});
    await client.getFlags();
    let switched: Promise<void> | undefined;
    client.registerContext(`reentrant-${field}`, () => {
      switched = client.setContext({ [field]: field === 'identity' ? 'bob' : 'token-b' });
      return { kind: 'Account', key: 'a-1', attributes: { Plan: 'pro' } };
    });
    await expect(client.getFlag('Feature', false, {}, `reentrant-${field}`)).resolves.toBe(true);
    await switched;
    await client.flushTelemetry();
    expect(packets).toEqual([field === 'identity' ? expected('alice', true) : { k: 'attribution-app', e: 'Production', i: 'token-a', f: { Feature: { enabled: [1] } } }]);
    await expect(client.getFlag('Feature')).resolves.toBe(false);
    await client.flushTelemetry();
    expect(packets[1]).toEqual(field === 'identity' ? expected('bob', false) : { k: 'attribution-app', e: 'Production', i: 'token-b', f: { Feature: { disabled: [1] } } });
  });

  it('binds a cached value before the await continuation can change context', async () => {
    const client = makeClient({ fetch: vi.fn(async url => response({ Feature: new URL(String(url)).searchParams.get('u') !== 'bob' })) });
    await client.getFlags();
    const evaluated = client.getFlag('Feature');
    const switched = client.setContext({ identity: 'bob' });
    await expect(evaluated).resolves.toBe(true);
    await switched; await client.flushTelemetry();
    expect(packets).toEqual([expected('alice', true)]);
    await expect(client.getFlag('Feature')).resolves.toBe(false);
    await client.flushTelemetry();
    expect(packets[1]).toEqual(expected('bob', false));
  });

  it.each(['success', 'failure'] as const)('binds the newer cached context returned after a superseded in-flight %s', async outcome => {
    let resolveOld!: (value: Response) => void;
    let rejectOld!: (error: Error) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
      .mockResolvedValue(response({ Feature: false }));
    const client = makeClient({ fetch });
    const evaluated = client.getFlag('Feature');
    await client.setContext({ identity: 'bob' });
    if (outcome === 'success') resolveOld(response({ Feature: true }));
    else rejectOld(new Error('old request aborted'));
    await expect(evaluated).resolves.toBe(false);
    await client.flushTelemetry();
    expect(packets).toEqual([expected('bob', false)]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('binds current-context defaults while both old and replacement requests are pending', async () => {
    let resolveOld!: (value: Response) => void;
    let resolveNew!: (value: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveNew = resolve; }));
    const client = makeClient({ fetch, flagDefaults: { Feature: false } });
    const evaluated = client.getFlag('Feature');
    const switched = client.setContext({ identity: 'bob' });
    resolveOld(response({ Feature: true }));
    await expect(evaluated).resolves.toBe(false);
    await client.flushTelemetry();
    expect(packets).toEqual([expected('bob', false)]);
    resolveNew(response({ Feature: true })); await switched;
    await expect(client.getFlag('Feature')).resolves.toBe(true);
    await client.flushTelemetry();
    expect(packets[1]).toEqual(expected('bob', true));
  });

  it.each(['mapper', 'await'] as const)('does not record a captured check after disposal during %s', async boundary => {
    const client = makeClient({ fetch: vi.fn().mockResolvedValue(response({ Feature: true })) });
    await client.getFlags();
    client.registerContext('dispose-evaluation', () => { client.dispose({ flush: false }); return { kind: 'Account', key: 'a-1' }; });
    const result = boundary === 'mapper' ? client.getFlag('Feature', false, {}, 'dispose-evaluation') : client.getFlag('Feature');
    if (boundary === 'await') client.dispose({ flush: false });
    await expect(result).resolves.toBe(true); await client.flushTelemetry();
    expect(packets).toEqual([]);
  });

  it('keeps client ownership separate and counts fallback evaluations once', async () => {
    const first = makeClient({ fetch: vi.fn().mockResolvedValue(response({})) });
    const second = makeClient({ appKey: 'other-app', identity: 'bob', fetch: vi.fn().mockResolvedValue(response({ Feature: false })) });
    first.registerContext('other-owner', () => { second.recordUsage('Other'); return { kind: 'Account', key: 'a-1' }; });
    await expect(first.getFlag('Feature', true, {}, 'other-owner')).resolves.toBe(true);
    await first.flushTelemetry(); await second.flushTelemetry();
    expect(packets).toEqual([expected('alice', true), { k: 'other-app', e: 'Production', u: 'bob', f: { Other: { enabled: [0, 1] } } }]);
  });
});
