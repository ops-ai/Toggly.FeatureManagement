import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TogglyServer } from '../server/toggly-server.js';
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types';

const datetimeGate: EntityGate = {
  requirement: 'all',
  rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' }],
};

const orderContext = {
  kind: 'Order',
  key: '1',
  attributes: { BirthDate: '2026-06-15T00:00:00Z' },
};

function createServer() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        PlainOn: true,
        PlainOff: false,
        EntityGated: datetimeGate,
      }),
    text: () =>
      Promise.resolve(
        JSON.stringify({
          PlainOn: true,
          PlainOff: false,
          EntityGated: datetimeGate,
        }),
      ),
  } as Response);

  return new TogglyServer({ appKey: 'test-key', environment: 'Production' });
}

describe('Entity context evaluation', () => {
  beforeEach(() => {
    clearRegisteredContexts();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    clearRegisteredContexts();
    vi.restoreAllMocks();
  });

  it('leaves plain booleans unchanged without context', async () => {
    const server = createServer();
    await expect(server.getFlag('PlainOn')).resolves.toBe(true);
    await expect(server.getFlag('PlainOff')).resolves.toBe(false);
  });

  it('fails closed for entity gates without context', async () => {
    const server = createServer();
    await expect(server.getFlag('EntityGated')).resolves.toBe(false);
  });

  it('evaluates entity gates with matching attributes', async () => {
    const server = createServer();
    await expect(server.getFlag('EntityGated', false, orderContext)).resolves.toBe(true);
  });

  it('fails closed when a mapped entity is missing the rule attribute', async () => {
    const server = createServer();
    server.registerContext<{ id: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: {},
    }));
    await expect(server.getFlag('EntityGated', false, { id: '9' }, 'Order')).resolves.toBe(false);
  });

  it('evaluates entity gates via registerContext mapper', async () => {
    const server = createServer();
    server.registerContext<{ id: string; birthDate: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: { BirthDate: order.birthDate },
    }));

    await expect(
      server.getFlag('EntityGated', false, { id: '7', birthDate: '2026-06-15T00:00:00Z' }, 'Order'),
    ).resolves.toBe(true);
    await expect(
      server.getFlag('EntityGated', false, { id: '8', birthDate: '2020-01-01T00:00:00Z' }, 'Order'),
    ).resolves.toBe(false);
  });
});
