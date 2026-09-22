<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createToggly, type TogglySnapshot } from '@ops-ai/toggly-sveltekit';
  import Feature from '@ops-ai/toggly-sveltekit/Feature.svelte';
  export let snapshot: TogglySnapshot;
  export let baseURI: string;
  export let frontendKey: string;
  export let telemetryEnabled: boolean;
  let telemetryStatus = 'idle';
  let local = true;
  let failures = 0;
  const toggly = createToggly(snapshot, {
    appKey: frontendKey,
    environment: 'Fixture',
    enableTelemetry: telemetryEnabled,
    metricsBaseUrl: baseURI + '/metrics',
    baseURI,
    refreshInterval: 200,
    timeout: 2000,
    onError: () => {
      failures++;
      throw Error('host browser observer failed');
    },
    localGates: [{ id: 'local', flagKeys: ['on'], isEnabled: () => local }],
  });
  $: toggly.update(snapshot);
  $: enabled = $toggly && toggly.isEnabled('on');
  $: vip =
    $toggly &&
    toggly.isEnabled('Order', { entity: { kind: 'Order', key: '1', attributes: { Vip: true } } });
  $: noEntity = $toggly && toggly.isEnabled('Order');
  onMount(() => {
    void toggly.start();
  });
  onDestroy(() => toggly.dispose());
</script>

<Feature {toggly} feature="on"><p data-testid="on">ON</p></Feature>
<Feature {toggly} feature="on" options={{ negate: true }}><p data-testid="off">OFF</p></Feature>
<p data-testid="programmatic">{String(enabled)}</p>
<p data-testid="vip">{String(vip)}</p>
<p data-testid="no-entity">{String(noEntity)}</p>
<Feature {toggly} feature={['on', 'off']} options={{ requirement: 'any' }}
  ><p data-testid="any">ANY</p></Feature
>
<Feature {toggly} feature="off" options={{ negate: true }}
  ><p data-testid="negate">NEGATED</p></Feature
>
<output data-testid="refresh-errors">{failures}</output>
<pre data-testid="snapshot">{JSON.stringify($toggly)}</pre>
<button
  on:click={() => {
    local = !local;
    toggly.notifyLocalGatesChanged();
  }}>Local prerequisite</button
>

<button
  on:click={() => {
    toggly.recordUsage('checkout', 'variant-a');
    toggly.recordView('checkout', 'variant-a');
    toggly.incrementCounter('orders', 2);
    toggly.setGauge('cart', 3.5);
    telemetryStatus = 'queued';
  }}>Record telemetry</button
>
<button
  on:click={async () => {
    await toggly.flushTelemetry();
    telemetryStatus = 'flushed';
  }}>Flush telemetry</button
>
<output data-testid="telemetry-status">{telemetryStatus}</output>
