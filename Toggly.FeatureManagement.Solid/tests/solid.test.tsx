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
  useVariant,
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
          <Feature feature="off">hidden</Feature>
          <Feature feature="off" negate>
            <span>disabled content</span>
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
    expect(screen.getByText('disabled content')).toBeTruthy();
    expect(screen.getByText('true/true/true')).toBeTruthy();
    change('off');
    expect(screen.getByText('false/true/true')).toBeTruthy();
  });
  it('supports a resource with Suspense, loading UI and lazy gated children', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    const child = vi.fn(() => <span>expensive</span>);
    const disabledChild = vi.fn(() => <span>disabled experience</span>);
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
        <Feature feature="on" negate>
          {disabledChild()}
        </Feature>
        <Suspense fallback={<span>Loading resource</span>}>
          <Reader />
        </Suspense>
      </TogglyProvider>
    ));
    expect(screen.getByText('Loading gate')).toBeTruthy();
    expect(screen.getByText('Loading resource')).toBeTruthy();
    expect(child).not.toHaveBeenCalled();
    expect(disabledChild).not.toHaveBeenCalled();
    expect(screen.queryByText('expensive')).toBeNull();
    expect(screen.queryByText('disabled experience')).toBeNull();
    resolve(new Response('{"on":true}'));
    await screen.findByText('expensive');
    expect(child).toHaveBeenCalledTimes(1);
    expect(disabledChild).not.toHaveBeenCalled();
  });
  it.each(['all', 'any'] as const)(
    'keeps paired %s gates complementary when entity and snapshot values change',
    (requirement) => {
      const [vip, setVip] = createSignal(false);
      const [enabled, setEnabled] = createSignal(true);
      const yes = vi.fn(() => <span>paired enabled</span>);
      const no = vi.fn(() => <span>paired disabled</span>);
      const entity = () => ({ kind: 'Order', key: '1', attributes: { Vip: vip() } });
      render(() => (
        <TogglyProvider
          snapshot={{
            definitions: {
              on: enabled(),
              checkout: {
                requirement: 'all',
                rules: [{ property: 'Vip', op: 'eq', value: 'true', type: 'boolean' }],
              },
            },
            context: {},
            expose: ['on', 'checkout'],
            source: 'signed',
          }}
        >
          <Feature feature={['on', 'checkout']} requirement={requirement} entity={entity()}>
            {yes()}
          </Feature>
          <Feature feature={['on', 'checkout']} requirement={requirement} entity={entity()} negate>
            {no()}
          </Feature>
        </TogglyProvider>
      ));
      const assertBranch = (allowed: boolean) => {
        expect(screen.queryByText('paired enabled') !== null).toBe(allowed);
        expect(screen.queryByText('paired disabled') !== null).toBe(!allowed);
      };
      assertBranch(requirement === 'any');
      expect(requirement === 'any' ? no : yes).not.toHaveBeenCalled();
      setVip(true);
      assertBranch(true);
      setEnabled(false);
      assertBranch(requirement === 'any');
      setVip(false);
      assertBranch(false);
    },
  );
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

describe('variants', () => {
  const variantBody = () =>
    JSON.stringify({
      On: { enabled: true, variant: 'blue', configurationValue: 42 },
      Off: { enabled: false, variant: 'red' },
    });

  it('is null everywhere when enableVariants is not set', async () => {
    const Reader = () => {
      const t = useToggly();
      const variant = useVariant('On');
      return (
        <p>
          {String(t.getVariant('On'))}/{String(t.getVariantValue('On'))}/{String(variant())}
        </p>
      );
    };
    render(() => (
      <TogglyProvider config={{ flagDefaults: { On: true } }}>
        <Reader />
      </TogglyProvider>
    ));
    await screen.findByText('null/null/null');
  });

  it('exposes the assigned variant reactively via getVariant, getVariantValue and useVariant', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(variantBody()));
    const Reader = () => {
      const t = useToggly();
      const variant = useVariant('On');
      return (
        <p>
          {JSON.stringify(t.getVariant('On'))}/{String(t.getVariantValue('On'))}/
          {JSON.stringify(variant())}
        </p>
      );
    };
    render(() => (
      <TogglyProvider
        config={{
          appKey: 'test',
          verifySignatures: false,
          enableVariants: true,
          fetch: fetcher,
          enableLiveUpdates: false,
        }}
      >
        <Reader />
      </TogglyProvider>
    ));
    await waitFor(() =>
      expect(screen.getByText(/blue/).textContent).toBe(
        '{"name":"blue","configurationValue":42}/42/{"name":"blue","configurationValue":42}',
      ),
    );
  });

  it('is null for a disabled feature and updates reactively on refresh', async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    const Reader = () => {
      const variant = useVariant('Off');
      return <p>{String(variant())}</p>;
    };
    render(() => (
      <TogglyProvider
        config={{
          appKey: 'test',
          verifySignatures: false,
          enableVariants: true,
          fetch: fetcher,
          enableLiveUpdates: false,
        }}
      >
        <Reader />
      </TogglyProvider>
    ));
    expect(screen.getByText('null')).toBeTruthy();
    resolve(new Response(variantBody()));
    await waitFor(() => expect(screen.getByText('null')).toBeTruthy());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('/evaluated-variants-signed/');
  });
});
