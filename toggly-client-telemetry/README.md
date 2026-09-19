# @ops-ai/toggly-client-telemetry

Dependency-free telemetry transport shared by Toggly frontend SDKs. The package
aggregates feature checks, explicit usage/views, and application metrics. It
runs in browsers, React Native and Electron without requiring browser globals.
Use one reporter per client instance; server and build-time clients should not
create a frontend reporter.

```ts
import { createTelemetryReporter } from '@ops-ai/toggly-client-telemetry';
import { attachBrowserLifecycle } from '@ops-ai/toggly-client-telemetry/browser';

const reporter = createTelemetryReporter({
  appKey: 'your-application-key',
  environment: 'Production',
  enableTelemetry: true,
  metricsBaseUrl: 'https://metrics.toggly.io',
  telemetryFlushIntervalMs: 45000,
});
const detach = attachBrowserLifecycle(reporter); // Optional in browsers

// Authoritative SDK evaluation paths record checks once per evaluated feature.
reporter.recordCheck('checkout', 'enabled');
// These events never trigger a feature evaluation.
reporter.recordUsage('checkout');
reporter.recordView('checkout', 'experiment-a');
reporter.incrementCounter('orders', 1);
reporter.setGauge('cartValue', 19.5);
await reporter.flush();

// Dispose before replacing a client or changing app/environment.
detach();
reporter.dispose(); // Synchronous; initiates one bounded best-effort final flush.
```

`recordUsage` and `recordView` default to variant `enabled`. Variant names must
contain 1 through 64 ASCII letters, digits, underscores or hyphens. Unsupported
names are rejected with a bounded diagnostic; they never change accepted events
or get remapped to another variant.

`incrementCounter` defaults to one. Counter inputs must be nonnegative integers
at most 1,000,000; gauges must be finite numbers from zero through 1,000,000.
Counters sum and gauges retain their latest value. Accumulated counters split
into valid server-sized deltas. Metric names are bare names, without metric type
prefixes or labels. A metric cannot switch between counter and gauge while it
is buffered or in flight. Invalid events are ignored.

`flush({ keepalive: true })` sends uncompressed JSON for browser exit events.
The browser adapter flushes on hidden visibility and pagehide, returns an
idempotent detach function, and automatically detaches on reporter disposal.
Native integrations should forward their background lifecycle event to flush.
Imports start no work. Missing application keys or `enableTelemetry: false`
produce no listeners, timers, queues or requests.

The default interval is 45 seconds. Configure a base interval from 30 through
60 seconds; each schedule is jittered by ±20%. Invalid intervals fall back to
45 seconds. A custom metrics base URL must be absolute HTTP(S), without
credentials, query or fragment (even an empty `?` or `#` delimiter); invalid
endpoints disable telemetry. Routes are constructed from the parsed URL, and its
normalized base path is preserved when appending `/api/frontend/telemetry`. Requests omit
credentials and SDK authentication/context headers. A custom `fetch` can be
provided through the portable `TelemetryFetch` interface.

Ordinary flushes prefer platform-native gzip when available, falling back to
JSON if compression fails before sending. Only HTTP 202 acknowledges a batch.
Only explicit 429/503 responses retry: at most twice after 30 and 60 seconds,
respecting longer readable Retry-After values and a five-minute batch expiry.
Network errors and five-second timeouts are dropped without replay. Requests
are serialized so older gauge retries cannot overwrite newer observations.
Disposal cancels periodic/retry timers and sends at most one final envelope;
remaining data is discarded because teardown is best effort. Await `flush()`
before disposal when deterministic completion is required.

Envelopes are at most 48 KiB of uncompressed UTF-8, with at most 16 variants per
feature. Admission reserves eventual numeric chunks within 2,000 entries and
256 KiB, counting pending and in-flight data. This conservative reservation may
reject new events before a densely combined envelope reaches those limits.
Accepted queued data is not evicted to admit new data. Individual entries too
large for an envelope are rejected. No telemetry is persisted.

The wire body contains `k` (app key), `e` (environment), `f` (feature variant
counts) and `m` (application metrics), plus optional `i` (minted instance id)
or `u` (client identity when `instanceId` is not set). It contains no groups,
claims, entity, timestamps or metric kind. Optional `onDiagnostic` receives at
most ten payload-free diagnostic codes per reporter; callback exceptions are
swallowed.

Both ESM and CommonJS entry points include declarations that work without
`lib.dom`, including TypeScript 4.8 and 4.9 consumers using classic Node or Node16 module
resolution for the root and browser entry points.

## Development

```sh
npm ci
npm run typecheck
npm run build
npm run test:coverage
npm run test:packed
```

The tests consume the common fixtures at `../tests/frontend-telemetry/contract.json`.
