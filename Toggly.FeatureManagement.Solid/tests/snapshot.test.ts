import { describe, it, expect } from 'vitest';
import { selectDefinitions } from '../src/snapshot';
import { createClient } from '../src/client';
const gate = (rule: unknown) => ({ requirement: 'all', rules: [rule] });
describe('complete evaluated-map validation', () => {
  it.each([
    null,
    [],
    { visible: null },
    { visible: { rules: [] } },
    { visible: { requirement: 'all', rules: {} } },
    ...[
      null,
      [],
      {},
      { property: 'Vip' },
      { property: 1, op: 'eq', value: 'true' },
      { property: 'Vip', op: 1, value: 'true' },
      { property: 'Vip', op: 'eq', value: true },
      { property: 'Vip', op: 'unknown', value: 'true' },
      { property: 'Vip', op: 'eq', value: 'true', type: 'unknown' },
      { property: 'Vip', op: 'eq', value: 'true', type: null },
    ].map((rule) => ({ visible: gate(rule) })),
  ])('rejects malformed full map %#', (definitions) => {
    expect(() => selectDefinitions(definitions as any, ['safe'])).toThrow(
      'Invalid evaluated definitions',
    );
  });
  it('preserves supported operators, optional types and empty predicates', () => {
    const rules = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'EQ', 'Contains'].map(
      (op) => ({ property: '', op, value: '' }),
    );
    const types = ['datetime', 'number', 'boolean', 'string', 'string[]'];
    const definitions = {
      visible: {
        requirement: 'any' as const,
        rules: [
          ...rules,
          ...types.map((type) => ({ property: 'Vip', op: 'eq', value: 'true', type })),
        ],
      },
      empty: { requirement: 'all' as const, rules: [] },
      safe: true,
    };
    expect(selectDefinitions(definitions as any)).toEqual(definitions);
    const client = createClient(
      {},
      { definitions: definitions as any, context: {}, expose: ['empty'], source: 'signed' },
    );
    expect(
      client.evaluate(['empty'], 'all', false, {
        kind: 'Order',
        key: '1',
        attributes: { Vip: true },
      }),
    ).toBe(false);
    client.dispose();
  });
});
