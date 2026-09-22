/** @jest-environment node */
import { buildDefinitionFetchHeaders, SDK_ID, SDK_VERSION } from '../lib/sdk-identity';

test('definition fetch uses User-Agent outside browser contexts', () => {
  const headers = buildDefinitionFetchHeaders({ Accept: 'application/json' });
  expect(headers['User-Agent']).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`);
  expect(headers['X-Toggly-Sdk']).toBeUndefined();
  expect(headers.Accept).toBe('application/json');
});

test('React Native navigator uses custom definition headers without browser globals', () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { product: 'ReactNative' },
  });
  try {
    const headers = buildDefinitionFetchHeaders();
    expect(headers['X-Toggly-Sdk']).toBe(SDK_ID);
    expect(headers['User-Agent']).toBeUndefined();
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
