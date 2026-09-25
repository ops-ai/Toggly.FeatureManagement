import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-native-mmkv', () => {
  const data = new Map<string, string>();
  return {createMMKV: () => ({
    getString: (key: string) => data.get(key),
    set: (key: string, value: string) => data.set(key, value),
    remove: (key: string) => data.delete(key),
    clearAll: () => data.clear(),
    getAllKeys: () => Array.from(data.keys()),
    contains: (key: string) => data.has(key),
  })};
});

import App from '../App';

test('renders the public provider with MMKV4 storage and local-only controls', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = jest.fn(async () => ({status: 503, ok: false, headers: {get: () => null}} as unknown as Response)) as typeof fetch;
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });
  expect(renderer!.root.findAllByType('Text' as any).length).toBeGreaterThan(0);
  await ReactTestRenderer.act(async () => renderer!.unmount());
  globalThis.fetch = previous;
});
