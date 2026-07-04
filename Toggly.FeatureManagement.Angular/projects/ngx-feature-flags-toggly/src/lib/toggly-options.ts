import { Injectable, Provider } from '@angular/core'
import { ITogglyOptions } from './models'

import type { Hook } from '@ops-ai/toggly-hooks-types';

/**
 * Configuration options for Toggly
 */
@Injectable({
  providedIn: 'root',
})
export class TogglyOptions implements ITogglyOptions {
  /** Base URI for the Toggly definitions API (default: https://definitions.toggly.io) */
  baseURI?: string

  /** Whether signatures should be verified on signed responses */
  verifySignatures?: boolean

  /** Your Toggly application key */
  appKey?: string

  /** Environment name (default: Production) */
  environment?: string

  /** User identity for personalized feature flags */
  identity?: string

  /** Default feature flag values when offline or during initialization */
  featureDefaults?: { [key: string]: boolean }

  /** Whether to show features during evaluation (default: false) */
  showFeatureDuringEvaluation?: boolean

  /** Custom URL for fetching feature definitions */
  customDefinitionsUrl?: string

  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[]

  /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
  persistCache?: boolean

  /**
   * When true, fetches from evaluated-variants-signed and exposes variant APIs.
   * Default: false.
   */
  enableVariants?: boolean

  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: import('@ops-ai/toggly-local-gates').LocalGate[]

  /** Optional SDK error callback for reporting fetch/cache/evaluation failures. */
  onError?: (message: string, error?: unknown) => void
}

/**
 * Provider function for standalone Angular applications (Angular 15+)
 *
 * Usage in app.config.ts:
 * ```typescript
 * import { provideToggly } from '@ops-ai/ngx-feature-flags-toggly';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideToggly({
 *       appKey: 'your-app-key',
 *       environment: 'Production'
 *     })
 *   ]
 * };
 * ```
 *
 * Usage in main.ts:
 * ```typescript
 * import { bootstrapApplication } from '@angular/platform-browser';
 * import { provideToggly } from '@ops-ai/ngx-feature-flags-toggly';
 *
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     provideToggly({
 *       appKey: 'your-app-key',
 *       environment: 'Production'
 *     })
 *   ]
 * });
 * ```
 */
export function provideToggly(config: ITogglyOptions): Provider {
  return {
    provide: TogglyOptions,
    useValue: config,
  }
}
