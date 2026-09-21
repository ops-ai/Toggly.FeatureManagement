import {
  createTelemetryReporter,
  type TelemetryReporter,
  type TelemetryDiagnostic,
} from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import type { TogglyConfig } from './toggly-client.js';

/** Internal provider lease. Construction is silent even during abandoned renders. */
export function createBrowserTelemetry(config: TogglyConfig) {
  config = { ...config };
  let reporter: TelemetryReporter | undefined;
  let detach: (() => void) | undefined;
  let disposed = false;
  return {
    activate(
      context: Pick<TogglyConfig, 'identity' | 'instanceId'>,
      ready: (reporter: TelemetryReporter) => void
    ) {
      if (
        disposed ||
        config.enableTelemetry === false ||
        !config.appKey?.trim() ||
        typeof window === 'undefined' ||
        typeof document === 'undefined'
      )
        return;
      if (!reporter) {
        // The factory may diagnose synchronously. Publish its one owner before
        // invoking host callbacks, which may immediately evaluate or record.
        let constructing = true;
        const diagnostics: TelemetryDiagnostic[] = [];
        const deliver = (diagnostic: TelemetryDiagnostic) => {
          try {
            config.onTelemetryDiagnostic?.(diagnostic);
          } catch {
            /* diagnostics are isolated */
          }
        };
        reporter = createTelemetryReporter({
          appKey: config.appKey,
          environment: config.environment,
          metricsBaseUrl: config.metricsBaseUrl,
          telemetryFlushIntervalMs: config.telemetryFlushIntervalMs,
          fetch: config.telemetryFetch,
          onDiagnostic: (diagnostic) => {
            if (constructing) diagnostics.push(diagnostic);
            else deliver(diagnostic);
          },
          ...context,
        });
        if (disposed) {
          reporter.dispose({ flush: false });
          return;
        }
        detach = attachBrowserLifecycle(reporter);
        ready(reporter);
        constructing = false;
        for (const diagnostic of diagnostics) {
          if (disposed) break;
          deliver(diagnostic);
        }
        if (disposed) return;
      } else {
        reporter.setContext(context);
        ready(reporter);
      }
      return reporter;
    },
    dispose(flush = true) {
      if (disposed) return;
      disposed = true;
      detach?.();
      reporter?.dispose({ flush });
    },
  };
}
export type BrowserTelemetry = ReturnType<typeof createBrowserTelemetry>;
