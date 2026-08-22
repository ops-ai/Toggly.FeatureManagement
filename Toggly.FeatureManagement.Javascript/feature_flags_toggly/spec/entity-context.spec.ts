import { Toggly } from '../lib/toggly';
import { FeatureRequirement } from '../lib/models';
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-entity'),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const orderGate: EntityGate = {
  requirement: 'all',
  rules: [{ property: 'Color', op: 'eq', value: 'brown' }],
};

interface Order {
  id: string;
  color: string;
}

async function initWithDefs(defs: Record<string, unknown>): Promise<void> {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ defs }),
  });

  await Toggly.init({
    appKey: 'entity-key',
    persistCache: false,
    enableLiveUpdates: false,
  });
}

describe('entity context evaluation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    Toggly.cancelRefreshInterval();
    mockFetch.mockReset();
    clearRegisteredContexts();
  });

  it('fails closed when a gated feature is read without an entity', async () => {
    await initWithDefs({ OrderFeature: orderGate });

    expect(Toggly.isFeatureOn('OrderFeature')).toBe(false);
  });

  it('evaluates a gate locally against a supplied entity context', async () => {
    await initWithDefs({ OrderFeature: orderGate });

    const matching = Toggly.isFeatureOn('OrderFeature', {
      kind: 'Order',
      key: '1',
      attributes: { Color: 'brown' },
    });
    const nonMatching = Toggly.isFeatureOn('OrderFeature', {
      kind: 'Order',
      key: '2',
      attributes: { Color: 'white' },
    });

    expect(matching).toBe(true);
    expect(nonMatching).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('maps a domain object through a registered context', async () => {
    await initWithDefs({ OrderFeature: orderGate });

    Toggly.registerContext<Order>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: { Color: order.status },
    }));

    expect(Toggly.isFeatureOn('OrderFeature', { id: '7', color: 'brown' }, 'Order')).toBe(true);
    expect(Toggly.isFeatureOn('OrderFeature', { id: '8', color: 'white' }, 'Order')).toBe(false);
  });

  it('fails closed when the entity kind was never registered', async () => {
    await initWithDefs({ OrderFeature: orderGate });

    expect(Toggly.isFeatureOn('OrderFeature', { id: '9', color: 'brown' }, 'Unregistered')).toBe(false);
  });

  it('leaves plain boolean definitions untouched when an entity is supplied', async () => {
    await initWithDefs({ PlainOn: true, PlainOff: false });

    const entity = { kind: 'Order', key: '1', attributes: { Color: 'brown' } };

    expect(Toggly.isFeatureOn('PlainOn', entity)).toBe(true);
    expect(Toggly.isFeatureOn('PlainOff', entity)).toBe(false);
  });

  it('applies entity context across a multi-feature gate', async () => {
    await initWithDefs({ PlainOn: true, OrderFeature: orderGate });

    const entity = { kind: 'Order', key: '1', attributes: { Color: 'brown' } };

    expect(
      Toggly.evaluateFeatureGate(['PlainOn', 'OrderFeature'], FeatureRequirement.all, false, entity),
    ).toBe(true);
    expect(
      Toggly.evaluateFeatureGate(['PlainOn', 'OrderFeature'], FeatureRequirement.all, false),
    ).toBe(false);
    expect(
      Toggly.evaluateFeatureGate(['PlainOn', 'OrderFeature'], FeatureRequirement.any, false),
    ).toBe(true);
  });

  it('reports gated features as disabled in the boolean flag snapshot', async () => {
    await initWithDefs({ PlainOn: true, OrderFeature: orderGate });

    const flags = await Toggly.refresh();

    expect(flags).toEqual({ PlainOn: true, OrderFeature: false });
  });
});
