import React, { useEffect, useState } from 'react';
import {
  $flag,
  $gate,
  Feature,
  FeatureGate,
  flushTelemetry,
  incrementCounter,
  initTogglyClient,
  recordUsage,
  recordView,
  setGauge,
  disposeTogglyClient,
  useFeatureFlag,
  useFeatureGate,
  useToggly,
} from '@ops-ai/gatsby-feature-flags-toggly';

function ClientProbe() {
  const direct = $flag('Visible').get();
  const computedGate = $gate(['Visible', 'Local'], 'all').get();
  const { isEnabled: hookFlag, isReady } = useFeatureFlag('Visible');
  const { isEnabled: anyGate } = useFeatureGate(['Visible', 'Skipped'], 'any');
  const { isEnabled: allGate } = useFeatureGate(['Visible', 'Local'], 'all');
  const { isEnabled: negatedGate } = useFeatureGate(['Hidden'], 'any', true);
  const { telemetry } = useToggly();

  if (typeof window !== 'undefined') {
    window.__gatsbyProbe = {
      recordUsage,
      flushTelemetry,
      initTogglyClient,
      disposeTogglyClient,
      localApi: 'http://127.0.0.1:8838',
    };
  }

  const explicit = async () => {
    recordUsage('manual-variant', 'treatment-b');
    recordView('manual-default');
    incrementCounter('orders', 2);
    incrementCounter('orders', 3);
    setGauge('cart-value', 10);
    setGauge('cart-value', 19);
    telemetry.recordUsage('context-variant', 'control-a');
    telemetry.recordView('context-default');
    telemetry.incrementCounter('context-orders', 4);
    telemetry.setGauge('context-gauge', 7);
    await telemetry.flush();
    await flushTelemetry();
    document.body.dataset.flushed = 'true';
  };

  return (
    <main>
      <h1>Gatsby public package telemetry probe</h1>
      <p id="ready">{String(isReady)}</p>
      <p id="direct">{String(direct)}</p>
      <p id="computed-gate">{String(computedGate)}</p>
      <p id="hook-flag">{String(hookFlag)}</p>
      <p id="hook-any">{String(anyGate)}</p>
      <p id="hook-all">{String(allGate)}</p>
      <p id="hook-negated">{String(negatedGate)}</p>
      <Feature flag="Visible"><span id="feature">feature-on</span></Feature>
      <Feature flag="Hidden" negate><span id="feature-negated">feature-off</span></Feature>
      <FeatureGate flags={['Visible', 'Skipped']} requirement="any">
        <span id="gate-any">any-on</span>
      </FeatureGate>
      <FeatureGate flags={['Visible', 'Local']} requirement="all">
        <span id="gate-all">all-on</span>
      </FeatureGate>
      <FeatureGate flags={['Hidden']} requirement="any" negate>
        <span id="gate-negated">none-on</span>
      </FeatureGate>
      <Feature flag="Entity" context={{ kind: 'Order', key: 'order-42', attributes: { enabled: true } }}>
        <span id="entity">entity-on</span>
      </Feature>
      <button id="explicit" onClick={explicit}>Record explicit events and flush</button>
      <button id="hidden" onClick={() => {
        recordUsage('hidden-lifecycle');
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }}>Hidden flush</button>
      <button id="opt-out" onClick={async () => {
        await initTogglyClient({ appKey: 'opt-out-app', baseURI: `${window.__gatsbyProbe.localApi}/definitions`, enableTelemetry: false, enableLiveUpdates: false, featureFlagsRefreshInterval: 0 });
        recordUsage('opt-out');
        await flushTelemetry();
      }}>Telemetry opt-out</button>
      <button id="keyless" onClick={async () => {
        await initTogglyClient({ appKey: '', enableTelemetry: true, enableLiveUpdates: false, featureFlagsRefreshInterval: 0 });
        recordUsage('keyless');
        await flushTelemetry();
      }}>Keyless</button>
    </main>
  );
}

function Probe() {
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      initTogglyClient({
        appKey: 'sample-browser-key',
        environment: 'Production',
        identity: 'sample-user-42',
        baseURI: 'http://127.0.0.1:8838/definitions',
        metricsBaseUrl: 'http://127.0.0.1:8838/metrics-local-gate',
        enableLiveUpdates: false,
        featureFlagsRefreshInterval: 0,
        localGates: [{ id: 'local-device-prerequisite', flagKeys: ['Local'], isEnabled: () => false }],
      }).then(() => setClientReady(true));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (!clientReady) {
    return (
      <main>
        <h1>Gatsby public package telemetry probe</h1>
        <p id="ssr">Static HTML rendered before the local browser client is ready.</p>
      </main>
    );
  }
  return <ClientProbe />;
}

export default Probe;
