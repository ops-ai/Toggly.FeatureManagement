import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { Toggly } from '../plugins/toggly.service';
import Feature from '../components/Feature.vue';
import FeatureGateBuilder from '../components/FeatureGateBuilder.vue';
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types';

const datetimeGate: EntityGate = {
  requirement: 'all',
  rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' }],
};

describe('Entity context evaluation', () => {
  let service: Toggly;

  beforeEach(() => {
    clearRegisteredContexts();
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    service = new Toggly();
    service.init({
      featureDefaults: {
        PlainOn: true,
        PlainOff: false,
        EntityGated: datetimeGate,
      },
    });
  });

  afterEach(() => {
    clearRegisteredContexts();
    vi.restoreAllMocks();
  });

  it('fails closed for entity gates without context', async () => {
    await expect(service.isFeatureOn('EntityGated')).resolves.toBe(false);
  });

  it('evaluates entity gates with TogglyEntityContext', async () => {
    await expect(
      service.isFeatureOn('EntityGated', {
        kind: 'Order',
        key: '1',
        attributes: { BirthDate: '2026-06-15T00:00:00Z' },
      }),
    ).resolves.toBe(true);
  });

  it('evaluates entity gates via registerContext mapper', async () => {
    service.registerContext<{ id: string; birthDate: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: { BirthDate: order.birthDate },
    }));

    await expect(
      service.isFeatureOn('EntityGated', { id: '42', birthDate: '2026-06-15T00:00:00Z' }, 'Order'),
    ).resolves.toBe(true);
  });

  it('leaves plain booleans unchanged without context', async () => {
    await expect(service.isFeatureOn('PlainOn')).resolves.toBe(true);
    await expect(service.isFeatureOn('PlainOff')).resolves.toBe(false);
  });

  it('fails closed when the mapped entity misses the rule', async () => {
    service.registerContext<{ id: string; birthDate: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: { BirthDate: order.birthDate },
    }));

    await expect(
      service.isFeatureOn('EntityGated', { id: '43', birthDate: '2020-01-01T00:00:00Z' }, 'Order'),
    ).resolves.toBe(false);
  });

  it('fails closed for an unregistered entity kind', async () => {
    await expect(
      service.isFeatureOn('EntityGated', { id: '44', birthDate: '2026-06-15T00:00:00Z' }, 'Kitten'),
    ).resolves.toBe(false);
  });

  it('ignores a domain object supplied without a kind', async () => {
    await expect(
      service.isFeatureOn('EntityGated', { id: '45', birthDate: '2026-06-15T00:00:00Z' }),
    ).resolves.toBe(false);
  });

  it('reports entity gates as off through isFeatureOff', async () => {
    await expect(service.isFeatureOff('EntityGated')).resolves.toBe(true);
    await expect(
      service.isFeatureOff('EntityGated', {
        kind: 'Order',
        key: '1',
        attributes: { BirthDate: '2026-06-15T00:00:00Z' },
      }),
    ).resolves.toBe(false);
  });

  it('applies entity context across all/any gates', async () => {
    const context = {
      kind: 'Order',
      key: '1',
      attributes: { BirthDate: '2026-06-15T00:00:00Z' },
    };

    await expect(
      service.evaluateFeatureGate(['PlainOn', 'EntityGated'], 'all', false, context),
    ).resolves.toBe(true);
    await expect(
      service.evaluateFeatureGate(['PlainOn', 'EntityGated'], 'all', false),
    ).resolves.toBe(false);
    await expect(
      service.evaluateFeatureGate(['PlainOff', 'EntityGated'], 'any', false, context),
    ).resolves.toBe(true);
    await expect(
      service.evaluateFeatureGate(['PlainOff', 'EntityGated'], 'any', false),
    ).resolves.toBe(false);
  });

  it('exposes gated features as false in the boolean snapshot', () => {
    expect(service.getEffectiveFlagValue('EntityGated')).toBe(false);
    expect(
      service.getEffectiveFlagValue('EntityGated', {
        kind: 'Order',
        key: '1',
        attributes: { BirthDate: '2026-06-15T00:00:00Z' },
      }),
    ).toBe(true);
  });

  it('Feature component accepts context prop', async () => {
    const wrapper = mount(Feature, {
      props: {
        featureKey: 'EntityGated',
        context: {
          kind: 'Order',
          key: '1',
          attributes: { BirthDate: '2026-06-15T00:00:00Z' },
        },
      },
      global: { provide: { $toggly: service } },
      slots: { default: '<span class="badge">Badge</span>' },
    });
    await flushPromises();
    expect(wrapper.find('.badge').exists()).toBe(true);
  });

  it('Feature component hides entity gate without context', async () => {
    const wrapper = mount(Feature, {
      props: { featureKey: 'EntityGated' },
      global: { provide: { $toggly: service } },
      slots: { default: '<span class="badge">Badge</span>' },
    });
    await flushPromises();
    expect(wrapper.find('.badge').exists()).toBe(false);
  });

  it('FeatureGateBuilder passes context through multi-key gates', async () => {
    const wrapper = mount(FeatureGateBuilder, {
      props: {
        featureKeys: ['PlainOn', 'EntityGated'],
        context: {
          kind: 'Order',
          key: '1',
          attributes: { BirthDate: '2026-06-15T00:00:00Z' },
        },
      },
      global: { provide: { $toggly: service } },
      slots: { default: `<span class="state">{{ enabled ? 'on' : 'off' }}</span>` },
    });

    await flushPromises();
    expect(wrapper.find('.state').text()).toBe('on');
  });

  it('FeatureGateBuilder fails closed for gated keys without context', async () => {
    const wrapper = mount(FeatureGateBuilder, {
      props: { featureKeys: ['PlainOn', 'EntityGated'] },
      global: { provide: { $toggly: service } },
      slots: { default: `<span class="state">{{ enabled ? 'on' : 'off' }}</span>` },
    });

    await flushPromises();
    expect(wrapper.find('.state').text()).toBe('off');
  });

  it('FeatureGateBuilder maps a domain object through contextKind', async () => {
    service.registerContext<{ id: string; birthDate: string }>('Order', (order) => ({
      kind: 'Order',
      key: order.id,
      attributes: { BirthDate: order.birthDate },
    }));

    const wrapper = mount(FeatureGateBuilder, {
      props: {
        featureKey: 'EntityGated',
        context: { id: '7', birthDate: '2026-06-15T00:00:00Z' },
        contextKind: 'Order',
      },
      global: { provide: { $toggly: service } },
      slots: { default: `<span class="state">{{ enabled ? 'on' : 'off' }}</span>` },
    });

    await flushPromises();
    expect(wrapper.find('.state').text()).toBe('on');
  });
});
