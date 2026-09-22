import type { FeatureProps } from '@ops-ai/solid-feature-flags-toggly';
import type { Toggly, TogglyOptions } from '@ops-ai/solid-feature-flags-toggly';

export function telemetryContract(toggly: Toggly): Promise<void> {
  void toggly.client.setContext({ instanceId: 'replacement' });
  toggly.recordUsage('feature', 'control');
  toggly.recordView('feature');
  toggly.incrementCounter('orders', 2);
  toggly.setGauge('cart', 3);
  return toggly.flushTelemetry();
}
export const telemetryOptions: TogglyOptions = {
  enableTelemetry: true,
  instanceId: 'host-minted-token',
  metricsBaseUrl: 'https://metrics.example/base',
  telemetryFlushIntervalMs: 45000,
};

type RequireFalse<T extends false> = T;

// Check the installed package contract, not just the source component's rendering.
export type FeatureHasNoDisabledContentProp = RequireFalse<
  'fallback' extends keyof FeatureProps ? true : false
>;
