import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTogglyClient } from './index';
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
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    clearRegisteredContexts();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        PlainOn: true,
        PlainOff: false,
        EntityGated: datetimeGate,
      }),
    });
  });

  afterEach(() => {
    clearRegisteredContexts();
  });

  function createClient() {
    return createTogglyClient({
      baseURI: 'https://client.toggly.io',
      environment: 'Production',
      appKey: 'test-app',
      fetch: mockFetch,
    });
  }

  it('leaves plain booleans unchanged without context', async () => {
    const client = createClient();
    await expect(client.getFlag('PlainOn')).resolves.toBe(true);
    await expect(client.getFlag('PlainOff')).resolves.toBe(false);
  });

  it('fails closed for entity gates without context', async () => {
    const client = createClient();
    await expect(client.getFlag('EntityGated')).resolves.toBe(false);
  });

  it('evaluates entity gates with matching attributes', async () => {
    const client = createClient();
    await expect(client.getFlag('EntityGated', false, puppyContext)).resolves.toBe(true);
  });

  it('fails closed when a mapped entity is missing the rule attribute', async () => {
    const client = createClient();
    client.registerContext<{ id: string }>('Puppy', (puppy) => ({
      kind: 'Puppy',
      key: puppy.id,
      attributes: {},
    }));
    await expect(client.getFlag('EntityGated', false, { id: '9' }, 'Puppy')).resolves.toBe(false);
  });

  it('evaluates entity gates via registerContext mapper', async () => {
    const client = createClient();
    client.registerContext<{ id: string; birthDate: string }>('Puppy', (puppy) => ({
      kind: 'Puppy',
      key: puppy.id,
      attributes: { BirthDate: puppy.birthDate },
    }));

    await expect(
      client.getFlag('EntityGated', false, { id: '7', birthDate: '2026-06-15T00:00:00Z' }, 'Puppy'),
    ).resolves.toBe(true);
    await expect(
      client.getFlag('EntityGated', false, { id: '8', birthDate: '2020-01-01T00:00:00Z' }, 'Puppy'),
    ).resolves.toBe(false);
  });
});
