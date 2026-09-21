import { A, createAsync, useSearchParams } from '@solidjs/router';
import { Show, onMount } from 'solid-js';
import {
  Feature,
  TogglyProvider,
  useToggly,
  createClient,
} from '@ops-ai/solid-feature-flags-toggly';
import { getFlags } from '../lib/flags';
function Status() {
  const flags = useToggly();
  onMount(() => {
    const mintedConfig = {
      appKey: 'minted-host',
      environment: 'Test',
      instanceId: 'A',
      identity: 'private',
      groups: ['private'],
      claims: { role: 'private' },
      baseURI: `${import.meta.env.VITE_TOGGLY_BASE_URL}/minted/?keep=ok&u=old&userId=old&g=one&g=two&claim.role=old`,
      metricsBaseUrl: import.meta.env.VITE_TOGGLY_METRICS_URL,
      storage: localStorage,
      enableLiveUpdates: false,
      refreshInterval: 0,
    };
    Object.assign(window, {
      telemetry: flags,
      async mintedChecks() {
        const client = createClient(mintedConfig);
        const results: boolean[] = [];
        try {
          await client.refresh();
          results.push(client.evaluate(['On']));
          await client.flushTelemetry();
          await client.setContext({ instanceId: 'B' });
          results.push(client.evaluate(['On']));
          client.recordUsage('B');
          await client.flushTelemetry();
          await client.setContext({ instanceId: 'A' });
          await client.refresh();
          results.push(client.evaluate(['On']));
          await client.flushTelemetry();
          await client.setContext({ identity: 'bob' });
          client.recordView('Cleared');
          await client.flushTelemetry();
          await client.setContext({ instanceId: 'A' });
          let pending: Promise<void> | undefined;
          const later = { id: 'later', flagKeys: ['Entity'], isEnabled: () => true };
          client.setLocalGates([
            {
              id: 'first',
              flagKeys: ['First'],
              isEnabled: () => {
                later.isEnabled = () => false;
                const selected = client.state().definitions.Entity;
                if (typeof selected !== 'boolean') selected.rules[0].value = 'retired';
                pending = client.setContext({ instanceId: 'B' });
                return true;
              },
            },
            later,
          ]);
          results.push(
            client.evaluate(['First', 'Entity'], 'all', false, {
              kind: 'User',
              key: 'one',
              attributes: { role: 'admin' },
            }),
          );
          await pending;
          client.recordUsage('After');
          await client.flushTelemetry();
          return results;
        } finally {
          client.dispose();
        }
      },
      async mintedOffline() {
        const client = createClient({ ...mintedConfig, enableTelemetry: false });
        try {
          await client.refresh();
          return { enabled: client.evaluate(['On']), error: !!client.state().error };
        } finally {
          client.dispose();
        }
      },
    });
  });
  return (
    <>
      <p data-testid="identity">{flags.client.context().identity}</p>
      <pre data-testid="flags">{JSON.stringify(flags.flags())}</pre>
      <button onClick={() => flags.client.refresh()}>Refresh</button>
    </>
  );
}
export default function Home() {
  const [params] = useSearchParams();
  const snapshot = createAsync(() => getFlags(String(params.identity ?? 'alice')));
  return (
    <>
      <A href="/?identity=alice">Alice</A>
      <A href="/?identity=bob">Bob</A>
      <A href="/away">Leave</A>
      <Show when={snapshot()}>
        {(initial) => (
          <TogglyProvider
            snapshot={snapshot() ?? initial()}
            config={{
              appKey: import.meta.env.VITE_TOGGLY_APP_KEY,
              baseURI: import.meta.env.VITE_TOGGLY_BASE_URL,
              metricsBaseUrl: import.meta.env.VITE_TOGGLY_METRICS_URL,
              refreshInterval: 0,
            }}
          >
            <Feature feature="BetaDashboard" loading={<p>Fetching flags</p>}>
              <h1>Beta enabled</h1>
            </Feature>
            <Feature feature="BetaDashboard" negate>
              <h1>Beta disabled</h1>
            </Feature>
            <Feature feature="LiveFeature">
              <p>Live on</p>
            </Feature>
            <Feature feature="LiveFeature" negate>
              <p>Live off</p>
            </Feature>
            <Feature
              feature="ExpressCheckout"
              entity={{ kind: 'Order', key: '1', attributes: { Vip: true } }}
            >
              <p>VIP checkout</p>
            </Feature>
            <Status />
          </TogglyProvider>
        )}
      </Show>
    </>
  );
}
