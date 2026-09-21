/**
 * Portable @ops-ai/toggly-client-core entry.
 *
 * This entry never imports browser lifecycle code, so server and edge consumers
 * do not allocate frontend telemetry resources. Browser-aware bundlers select
 * the conditional browser entry declared in package.json.
 */
import {
  createTogglyClientCore,
  type TogglyClient,
  type TogglyConfig,
} from './client.js';

export type { Flags, TogglyClient, TogglyConfig } from './client.js';

/** Create a portable server/edge client without browser lifecycle ownership. */
export function createTogglyClient(config: TogglyConfig = {}): TogglyClient {
  return createTogglyClientCore(config);
}
