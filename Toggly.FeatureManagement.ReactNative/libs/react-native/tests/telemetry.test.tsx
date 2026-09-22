import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { AppState } from 'react-native';
import { TogglyProvider } from '../src/components/TogglyProvider';
import { useFeatureFlag } from '../src/hooks/useFeatureFlag';
import { useToggly } from '../src/hooks/useToggly';

it('owns real Core telemetry across rerenders, AppState and opposite app/environment replacement', async () => {
  const packets: any[] = [];
  let state!: (value: string) => void;
  let api!: ReturnType<typeof useToggly>;
  const remove = jest.fn();
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, listener) => { state = listener; return { remove }; });
  Object.defineProperty(globalThis, 'CompressionStream', { value: undefined, configurable: true });
  (fetch as jest.Mock).mockImplementation(async (url: string, options: RequestInit) => {
    if (url.includes('/api/frontend/telemetry')) {
      packets.push(JSON.parse(options.body as string));
      expect(options.credentials).toBe('omit');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
      return { status: 202, headers: { get: () => null } };
    }
    return { status: 503, ok: false };
  });
  function Child() {
    api = useToggly();
    const flag = useFeatureFlag('on');
    return <div>{flag.isLoading ? 'loading' : flag.isEnabled ? 'ON' : 'OFF'}</div>;
  }
  const props = { metricsBaseUrl: 'https://collector.test', refreshInterval: 0, identity: 'private-user' };
  const view = render(<TogglyProvider {...props} appKey="old" environment="Old" featureDefaults={{ on: true }}><Child /></TogglyProvider>);
  await waitFor(() => expect(view.queryByText('ON')).not.toBeNull());
  await act(async () => { await api.flushTelemetry(); });
  expect(packets).toEqual([{ k: 'old', e: 'Old', u: 'private-user', f: { on: { enabled: [1] } } }]);
  expect(remove).not.toHaveBeenCalled();
  view.rerender(<TogglyProvider {...props} appKey="old" environment="Old" featureDefaults={{ on: true }}><Child /></TogglyProvider>);
  await act(async () => { api.recordUsage('checkout'); api.recordView('checkout'); api.incrementCounter('orders', 2); api.setGauge('cart', 3.5); state('background'); await api.flushTelemetry(); });
  expect(packets[1]).toEqual({ k: 'old', e: 'Old', u: 'private-user', f: { checkout: { enabled: [0, 1, 1] } }, m: { orders: 2, cart: 3.5 } });
  view.rerender(<TogglyProvider {...props} appKey="new" environment="New" featureDefaults={{ on: false }}><Child /></TogglyProvider>);
  await waitFor(() => expect(view.queryByText('OFF')).not.toBeNull());
  await act(async () => { await api.flushTelemetry(); });
  expect(packets[2]).toEqual({ k: 'new', e: 'New', u: 'private-user', f: { on: { disabled: [1] } } });
  expect(remove).toHaveBeenCalledTimes(1);
  const count = packets.length;
  view.unmount();
  await act(async () => { state('active'); await api.flushTelemetry(); });
  expect(packets).toHaveLength(count);
  expect(remove).toHaveBeenCalledTimes(2);
});
