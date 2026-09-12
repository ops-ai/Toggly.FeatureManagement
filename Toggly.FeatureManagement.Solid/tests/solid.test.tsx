import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { createRoot, createSignal, Suspense } from 'solid-js';
import {
  createToggly,
  Feature,
  TogglyProvider,
  useFeatureFlag,
  useFeatureFlags,
  useToggly,
} from '../src';
afterEach(cleanup);

describe('Solid ownership and native gates', () => {
  it('requires an owner and provider', () => {
    expect(() => createToggly()).toThrow('owner');
    expect(() => useToggly()).toThrow('TogglyProvider');
  });
  it('renders gates, bulk flags, reactive keys and entity context', async () => {
    let change!: (key: string) => void;
    const View = () => {
      const [key, setKey] = createSignal('on');
      change = setKey;
      const flag = useFeatureFlag(key);
      const bulk = useFeatureFlags();
      const fixed = useFeatureFlag('on', () => undefined);
      return (
        <>
          <p>
            {String(flag())}/{String(fixed())}/{String(bulk().on)}
          </p>
          <Feature feature={['on', 'off']} requirement="any">
            <span>any works</span>
          </Feature>
          <Feature feature="off" negate>
            <span>negate works</span>
          </Feature>
          <Feature feature="off" fallback={<span>fallback</span>}>
            hidden
          </Feature>
        </>
      );
    };
    render(() => (
      <TogglyProvider config={{ flagDefaults: { on: true, off: false } }}>
        <View />
      </TogglyProvider>
    ));
    await screen.findByText('any works');
    expect(screen.getByText('negate works')).toBeTruthy();
    expect(screen.getByText('fallback')).toBeTruthy();
    expect(screen.getByText('true/true/true')).toBeTruthy();
    change('off');
    expect(screen.getByText('false/true/true')).toBeTruthy();
  });
  it('supports a resource with Suspense, loading UI and lazy gated children', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    const child = vi.fn(() => <span>expensive</span>);
    const Reader = () => {
      const t = useToggly();
      return <span>{JSON.stringify(t.resource())}</span>;
    };
    render(() => (
      <TogglyProvider
        config={{
          appKey: 'test',
          verifySignatures: false,
          fetch: fetcher,
          enableLiveUpdates: false,
        }}
      >
        <Feature feature="on" loading={<span>Loading gate</span>}>
          {child()}
        </Feature>
        <Suspense fallback={<span>Loading resource</span>}>
          <Reader />
        </Suspense>
      </TogglyProvider>
    ));
    expect(screen.getByText('Loading gate')).toBeTruthy();
    expect(screen.getByText('Loading resource')).toBeTruthy();
    expect(child).not.toHaveBeenCalled();
    resolve(new Response('{"on":true}'));
    await screen.findByText('expensive');
    expect(child).toHaveBeenCalledTimes(1);
  });
  it('reacts to refresh, exposes errors and disposes subscriptions', async () => {
    let t!: ReturnType<typeof createToggly>;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      t = createToggly({
        appKey: 'test',
        verifySignatures: false,
        fetch: vi.fn().mockRejectedValue('offline'),
        enableLiveUpdates: false,
      });
    });
    await waitFor(() => expect(t.loading()).toBe(false));
    expect(t.error()?.message).toBe('offline');
    expect(t.flags()).toEqual({});
    dispose();
    expect(await t.client.refresh()).toEqual({});
  });
});
