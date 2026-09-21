/** Browser entry selected through the package's `browser` export condition. */
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import {
  createTogglyClientCore,
  type TogglyClient,
  type TogglyConfig,
} from './client.js';

export type { Flags, TogglyClient, TogglyConfig } from './client.js';

/** Create a browser client with one owned telemetry reporter and lifecycle adapter. */
export function createTogglyClient(config: TogglyConfig = {}): TogglyClient {
  return createTogglyClientCore(config, attachBrowserLifecycle);
}
