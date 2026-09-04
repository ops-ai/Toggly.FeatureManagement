/**
 * Tests for entity/page context evaluation in TogglyServerClient
 */

import { TogglyServerClient } from '../src/client';
import { clearRegisteredContexts } from '@ops-ai/remix-toggly-core';
import type { FeatureDefinitionModel } from '@ops-ai/remix-toggly-core';

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
    removeAllListeners: jest.fn(),
    send: jest.fn(),
    readyState: 1,
  }));
});

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
};

const definitionsPayload: FeatureDefinitionModel[] = [
  { featureKey: 'PlainOn', filters: [{ name: 'AlwaysOn', parameters: {} }] },
  { featureKey: 'PlainOff', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  entityGated,
];

const orderContext = {
  kind: 'Order',
  key: '1',
  attributes: { BirthDate: '2026-06-15T00:00:00Z' },
};

async function createClient() {
  const body = JSON.stringify(definitionsPayload);

  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(definitionsPayload),
    headers: { get: () => null },
  });

  const client = new TogglyServerClient({ appKey: 'test-app-key', environment: 'test' });
  await client.init();
  return client;
}

describe('entity context evaluation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    clearRegisteredContexts();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    clearRegisteredContexts();
    jest.restoreAllMocks();
  });

  it('fails closed for an entity gate evaluated without context', async () => {
    const client = await createClient();

    expect(await client.isEnabled('EntityGated')).toBe(false);
    expect(await client.isDisabled('EntityGated')).toBe(true);

    client.close();
  });

  it('evaluates an entity gate against a supplied context', async () => {
    const client = await createClient();

    expect(await client.isEnabled('EntityGated', undefined, false, orderContext)).toBe(true);
    expect(await client.isDisabled('EntityGated', undefined, true, orderContext)).toBe(false);

    client.close();
  });

  it('maps a domain object through a registered context mapper', async () => {
    const client = await createClient();

    client.registerContext<{ id: string; birthDate: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: { BirthDate: order.birthDate },
    }));

    expect(
      await client.isEnabled(
        'EntityGated',
        undefined,
        false,
        { id: '7', birthDate: '2026-06-15T00:00:00Z' },
        'Order',
      ),
    ).toBe(true);
    expect(
      await client.isEnabled(
        'EntityGated',
        undefined,
        false,
        { id: '8', birthDate: '2020-01-01T00:00:00Z' },
        'Order',
      ),
    ).toBe(false);

    client.close();
  });

  it('leaves plain boolean definitions untouched', async () => {
    const client = await createClient();

    expect(await client.isEnabled('PlainOn')).toBe(true);
    expect(await client.isEnabled('PlainOff')).toBe(false);

    client.close();
  });

  it('threads context through all and any gates', async () => {
    const client = await createClient();

    expect(
      await client.evaluateGate(['PlainOn', 'EntityGated'], 'all', false, false, orderContext),
    ).toBe(true);
    expect(await client.evaluateGate(['PlainOn', 'EntityGated'], 'all')).toBe(false);
    expect(
      await client.evaluateGate(['PlainOff', 'EntityGated'], 'any', false, false, orderContext),
    ).toBe(true);
    expect(await client.evaluateGate(['PlainOff', 'EntityGated'], 'any')).toBe(false);

    client.close();
  });

  it('hydrates a boolean snapshot (entity gates fail closed without context)', async () => {
    const client = await createClient();

    const context = client.getServerContext();
    expect(context.flags.PlainOn).toBe(true);
    expect(context.flags.PlainOff).toBe(false);
    expect(context.flags.EntityGated).toBe(false);

    client.close();
  });
});
