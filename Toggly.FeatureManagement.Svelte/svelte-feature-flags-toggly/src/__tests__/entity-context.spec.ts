import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Toggly } from '../services/toggly.service';
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types';

const datetimeGate: EntityGate = {
  requirement: 'all',
  rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' }],
};

const puppyContext = {
  kind: 'Puppy',
  key: '1',
  attributes: { BirthDate: '2026-06-15T00:00:00Z' },
};

describe('Entity context evaluation', () => {
  let service: Toggly;

  beforeEach(() => {
    clearRegisteredContexts();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    service = new Toggly({
      featureDefaults: {
        PlainOn: true,
        PlainOff: false,
        EntityGated: datetimeGate,
      } as { [key: string]: boolean },
    });
  });

  afterEach(() => {
    clearRegisteredContexts();
    vi.restoreAllMocks();
  });

  it('leaves plain booleans unchanged without context', async () => {
    await expect(service.isFeatureOn('PlainOn')).resolves.toBe(true);
    await expect(service.isFeatureOn('PlainOff')).resolves.toBe(false);
  });

  it('fails closed for entity gates without context', async () => {
    await expect(service.isFeatureOn('EntityGated')).resolves.toBe(false);
  });

  it('evaluates entity gates with matching attributes', async () => {
    await expect(service.isFeatureOn('EntityGated', puppyContext)).resolves.toBe(true);
  });

  it('fails closed when a mapped entity is missing the rule attribute', async () => {
    service.registerContext<{ id: string }>('Puppy', (puppy) => ({
      kind: 'Puppy',
      key: puppy.id,
      attributes: {},
    }));

    await expect(service.isFeatureOn('EntityGated', { id: '9' }, 'Puppy')).resolves.toBe(false);
  });

  it('evaluates entity gates via registerContext mapper', async () => {
    service.registerContext<{ id: string; birthDate: string }>('Puppy', (puppy) => ({
      kind: 'Puppy',
      key: puppy.id,
      attributes: { BirthDate: puppy.birthDate },
    }));

    await expect(
      service.isFeatureOn('EntityGated', { id: '42', birthDate: '2026-06-15T00:00:00Z' }, 'Puppy'),
    ).resolves.toBe(true);
    await expect(
      service.isFeatureOn('EntityGated', { id: '43', birthDate: '2020-01-01T00:00:00Z' }, 'Puppy'),
    ).resolves.toBe(false);
  });
});
