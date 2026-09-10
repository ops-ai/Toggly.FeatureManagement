import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { AppState } from 'react-native';
import { TogglyProvider } from '../src/components/TogglyProvider';

it('sends provider startup context in one request despite synchronous native callbacks', async () => {
  (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, headers: new Map(),
    json: async () => ({ enabled: true }) });
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, listener) => {
    listener('background'); listener('active'); return { remove: jest.fn() };
  });
  const view = render(<TogglyProvider appKey="app" identity="user&123"
    groups={['beta', 'team a']} claims={{ plan: 'pro' }} refreshInterval={0}
    networkInfo={{ getState: async () => ({ isConnected: true }), subscribe: listener => {
      listener({ isConnected: false }); listener({ isConnected: true }); return () => {};
    } }}><div>Loaded</div></TogglyProvider>);
  await waitFor(() => expect(view.queryByText('Loaded')).not.toBeNull());
  expect(fetch).toHaveBeenCalledTimes(1);
  const url = new URL((fetch as jest.Mock).mock.calls[0][0]);
  expect(url.searchParams.get('u')).toBe('user&123');
  expect(url.searchParams.getAll('g')).toEqual(['beta', 'team a']);
  expect(url.searchParams.get('claim.plan')).toBe('pro');
  view.unmount();
});
