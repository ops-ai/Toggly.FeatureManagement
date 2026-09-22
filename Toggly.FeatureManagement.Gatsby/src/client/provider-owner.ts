import { $flags, disposeTogglyClient } from './store.js';
import type { TogglyPluginOptions } from '../types/index.js';

// The atom belongs to the shared browser store, so compiled CJS and ESM
// Providers participate in the same lease without adding a public lifetime API.
const PROVIDER_LEASE = Symbol.for('@ops-ai/gatsby-feature-flags-toggly/provider-lease');
const sharedOwner = $flags as typeof $flags & { [PROVIDER_LEASE]?: Record<string, never> };

export function retainProviderOwner(config: TogglyPluginOptions): () => void {
  const lease = {};
  sharedOwner[PROVIDER_LEASE] = lease;
  return () => {
    // Let a committed successor (including StrictMode replay) claim the owner.
    // Its init call performs transport replacement with destroy(false).
    queueMicrotask(() => {
      if (sharedOwner[PROVIDER_LEASE] !== lease) return;
      delete sharedOwner[PROVIDER_LEASE];
      disposeTogglyClient(config);
    });
  };
}
