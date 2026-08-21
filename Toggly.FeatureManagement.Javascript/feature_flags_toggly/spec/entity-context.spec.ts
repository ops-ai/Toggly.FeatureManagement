import { Toggly } from '../lib/toggly';
import { FeatureRequirement } from '../lib/models';
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-entity'),
}));

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const puppyGate: EntityGate = {
  requirement: 'all',
  rules: [{ property: 'Color', op: 'eq', value: 'brown' }],
};

interface Puppy {
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
    await initWithDefs({ PuppyFeature: puppyGate });

    expect(Toggly.isFeatureOn('PuppyFeature')).toBe(false);
  });

  it('evaluates a gate locally against a supplied entity context', async () => {
    await initWithDefs({ PuppyFeature: puppyGate });

    const matching = Toggly.isFeatureOn('PuppyFeature', {
      kind: 'Puppy',
      key: '1',
      attributes: { Color: 'brown' },
    });
    const nonMatching = Toggly.isFeatureOn('PuppyFeature', {
      kind: 'Puppy',
      key: '2',
      attributes: { Color: 'white' },
    });

    expect(matching).toBe(true);
    expect(nonMatching).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('maps a domain object through a registered context', async () => {
    await initWithDefs({ PuppyFeature: puppyGate });

    Toggly.registerContext<Puppy>('Puppy', (puppy) => ({
      kind: 'Puppy',
      key: puppy.id,
      attributes: { Color: puppy.color },
    }));

    expect(Toggly.isFeatureOn('PuppyFeature', { id: '7', color: 'brown' }, 'Puppy')).toBe(true);
    expect(Toggly.isFeatureOn('PuppyFeature', { id: '8', color: 'white' }, 'Puppy')).toBe(false);
  });

  it('fails closed when the entity kind was never registered', async () => {
    await initWithDefs({ PuppyFeature: puppyGate });

    expect(Toggly.isFeatureOn('PuppyFeature', { id: '9', color: 'brown' }, 'Unregistered')).toBe(false);
  });

  it('leaves plain boolean definitions untouched when an entity is supplied', async () => {
    await initWithDefs({ PlainOn: true, PlainOff: false });

    const entity = { kind: 'Puppy', key: '1', attributes: { Color: 'brown' } };

    expect(Toggly.isFeatureOn('PlainOn', entity)).toBe(true);
    expect(Toggly.isFeatureOn('PlainOff', entity)).toBe(false);
  });

  it('applies entity context across a multi-feature gate', async () => {
    await initWithDefs({ PlainOn: true, PuppyFeature: puppyGate });

    const entity = { kind: 'Puppy', key: '1', attributes: { Color: 'brown' } };

    expect(
      Toggly.evaluateFeatureGate(['PlainOn', 'PuppyFeature'], FeatureRequirement.all, false, entity),
    ).toBe(true);
    expect(
      Toggly.evaluateFeatureGate(['PlainOn', 'PuppyFeature'], FeatureRequirement.all, false),
    ).toBe(false);
    expect(
      Toggly.evaluateFeatureGate(['PlainOn', 'PuppyFeature'], FeatureRequirement.any, false),
    ).toBe(true);
  });

  it('reports gated features as disabled in the boolean flag snapshot', async () => {
    await initWithDefs({ PlainOn: true, PuppyFeature: puppyGate });

    const flags = await Toggly.refresh();

    expect(flags).toEqual({ PlainOn: true, PuppyFeature: false });
  });
});
