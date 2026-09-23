import type { TogglyIntegrationOptions } from '@ops-ai/astro-feature-flags-toggly/integration';
import type { TogglyServer } from '@ops-ai/astro-feature-flags-toggly';
import type { FeatureProps as ReactFeatureProps } from '@ops-ai/astro-feature-flags-toggly/react';
import type { FeatureProps as VueFeatureProps } from '@ops-ai/astro-feature-flags-toggly/vue';
import { featureFlag, featureGate, featureVariant } from '@ops-ai/astro-feature-flags-toggly/svelte';

export const config: TogglyIntegrationOptions = { browserEnableUsageTracking: true, browserEnableMetrics: false, verifySignatures: true, flagDefaults: { Visible: false } };
export const reactProps: ReactFeatureProps = { flag: 'Visible', negate: false };
export const vueProps: VueFeatureProps = { flags: ['Visible'], requirement: 'all' };
export function publicTypes(client: TogglyServer) {
  return [client.getFlag('Visible'), featureFlag('Visible'), featureGate(['Visible']), featureVariant('Visible')];
}

import {recordUsage, recordView, incrementCounter, setGauge, flushTelemetry, destroyTogglyClient} from '@ops-ai/astro-feature-flags-toggly/client/store';
export function browserTelemetryTypes() {
  recordUsage('Visible'); recordView('Visible', 'control'); incrementCounter('orders', 2); setGauge('cart', 3);
  const completion: Promise<void> = flushTelemetry();
  destroyTogglyClient(); return completion;
}
export const telemetryConfig: TogglyIntegrationOptions = {instanceId: 'host-minted', identity: 'client-asserted',enableTelemetry: true, enableMetrics: true, metricsBaseUrl: 'https://collector.example/base', telemetryFlushIntervalMs: 45000};
