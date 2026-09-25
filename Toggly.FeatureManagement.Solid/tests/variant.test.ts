import { describe, it, expect, vi } from 'vitest';
import { createClient } from '../src/client';
import { selectVariantDefinitions, variantDefsToFlags } from '../src/variant';

const variantBody = () =>
  JSON.stringify({
    On: { enabled: true, variant: 'blue', configurationValue: 42 },
    Off: { enabled: false, variant: 'red' },
    NoVariant: { enabled: true },
  });

describe('variant selection helpers', () => {
  it('coerces, validates and filters variant defs', () => {
    expect(selectVariantDefinitions(JSON.parse(variantBody()), ['On'])).toEqual({
      On: { enabled: true, variant: 'blue', configurationValue: 42 },
    });
    expect(selectVariantDefinitions(null)).toEqual({});
    expect(selectVariantDefinitions([])).toEqual({});
    expect(() => selectVariantDefinitions({ On: { enabled: 'yes' } })).toThrow(
      'Invalid evaluated variant definitions',
    );
    expect(() => selectVariantDefinitions({ error: 'boom' })).toThrow(/error envelope/i);
  });
  it('derives boolean flags from variant defs', () => {
    expect(variantDefsToFlags(JSON.parse(variantBody()))).toEqual({
      On: true,
      Off: false,
      NoVariant: true,
    });
  });
});

describe('client variants (off by default)', () => {
  it('never fetches the variants endpoint and always returns null when disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ On: true })));
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    expect(String(fetcher.mock.calls[0][0])).toContain('/evaluated-signed/');
    expect(String(fetcher.mock.calls[0][0])).not.toContain('/evaluated-variants-signed/');
    expect(client.getVariant('On')).toBeNull();
    expect(client.getVariantValue('On')).toBeNull();
    client.dispose();
  });
});

describe('client variants (enabled)', () => {
  it('fetches the variants endpoint and booleanizes flags for evaluate()', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(variantBody()));
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      enableVariants: true,
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    expect(String(fetcher.mock.calls[0][0])).toContain('/evaluated-variants-signed/');
    expect(client.flags()).toEqual({ On: true, Off: false, NoVariant: true });
    expect(client.evaluate(['On'])).toBe(true);
    expect(client.evaluate(['Off'])).toBe(false);
    client.dispose();
  });

  it('returns the assigned variant and configuration value when enabled with a variant', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(variantBody()));
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      enableVariants: true,
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    expect(client.getVariant('On')).toEqual({ name: 'blue', configurationValue: 42 });
    expect(client.getVariantValue('On')).toBe(42);
    expect(client.getVariantValue<number>('On', (v): v is number => typeof v === 'number')).toBe(
      42,
    );
    expect(
      client.getVariantValue<{ x: number }>('On', (v): v is { x: number } => false),
    ).toBeNull();
    client.dispose();
  });

  it('returns null when the feature is disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(variantBody()));
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      enableVariants: true,
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    expect(client.getVariant('Off')).toBeNull();
    expect(client.getVariantValue('Off')).toBeNull();
    client.dispose();
  });

  it('returns null when enabled but no variant is assigned', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(variantBody()));
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      enableVariants: true,
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    expect(client.getVariant('NoVariant')).toBeNull();
    expect(client.getVariantValue('NoVariant')).toBeNull();
    client.dispose();
  });

  it('returns null for a missing feature key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(variantBody()));
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      enableVariants: true,
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    expect(client.getVariant('Missing')).toBeNull();
    expect(client.getVariantValue('Missing')).toBeNull();
    client.dispose();
  });

  it('a local gate can suppress an assigned variant but never invent one', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(variantBody()));
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      enableVariants: true,
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    client.setLocalGates([{ id: 'blocked', flagKeys: ['On'], isEnabled: () => false }]);
    expect(client.getVariant('On')).toBeNull();
    client.setLocalGates([]);
    expect(client.getVariant('On')).toEqual({ name: 'blue', configurationValue: 42 });
    client.dispose();
  });

  it('refetches the variants endpoint with new targeting on identity change', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(variantBody()))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ On: { enabled: true, variant: 'green', configurationValue: 7 } }),
        ),
      );
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      enableVariants: true,
      identity: 'alice',
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    expect(client.getVariant('On')).toEqual({ name: 'blue', configurationValue: 42 });
    await client.setContext({ identity: 'bob' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(String(fetcher.mock.calls[1][0]));
    expect(secondUrl.pathname).toContain('/evaluated-variants-signed/');
    expect(secondUrl.searchParams.get('userId')).toBe('bob');
    expect(client.getVariant('On')).toEqual({ name: 'green', configurationValue: 7 });
    client.dispose();
  });

  it('retains the previous variant assignment across a failed refresh', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(variantBody()))
      .mockRejectedValueOnce(new Error('offline'));
    const client = createClient({
      appKey: 'test',
      verifySignatures: false,
      enableVariants: true,
      fetch: fetcher,
      enableLiveUpdates: false,
    });
    await client.refresh();
    await client.refresh();
    expect(client.getVariant('On')).toEqual({ name: 'blue', configurationValue: 42 });
    expect(client.state().error).toBeInstanceOf(Error);
    client.dispose();
  });
});
