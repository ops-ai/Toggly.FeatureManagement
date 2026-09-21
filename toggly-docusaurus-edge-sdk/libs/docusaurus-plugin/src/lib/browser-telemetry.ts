import { createTelemetryReporter, type TelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';
import type { TogglyConfig } from './toggly-client.js';

/** Internal provider lease. Construction is silent even during abandoned renders. */
export function createBrowserTelemetry(config: TogglyConfig) {
  config = { ...config };
  let reporter: TelemetryReporter | undefined;
  let detach: (() => void) | undefined;
  let disposed = false;
  return {
    activate(context: Pick<TogglyConfig, 'identity' | 'instanceId'>) {
      if (
        disposed ||
        config.enableTelemetry === false ||
        !config.appKey?.trim() ||
        typeof window === 'undefined' ||
        typeof document === 'undefined'
      )
        return;
      if (!reporter) {
        reporter = createTelemetryReporter({
          appKey: config.appKey,
          environment: config.environment,
          metricsBaseUrl: config.metricsBaseUrl,
          telemetryFlushIntervalMs: config.telemetryFlushIntervalMs,
          fetch: config.telemetryFetch,
          onDiagnostic: config.onTelemetryDiagnostic,
          ...context,
        });
        if (disposed) {
          reporter.dispose({ flush: false });
          return;
        }
        detach = attachBrowserLifecycle(reporter);
      } else reporter.setContext(context);
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
