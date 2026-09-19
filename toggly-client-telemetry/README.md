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

// Atomically change attribution; already accepted events keep their old context.
reporter.setContext({ instanceId: 'host-minted-instance', identity: 'user-123' });
reporter.recordUsage('checkout'); // Admitted immediately under the minted instance.
reporter.setContext({ identity: 'user-123' }); // Clear instanceId, fall back to u.
reporter.setContext({}); // Clear both attribution fields.

// Normal teardown can send one final envelope.
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
Disposal cancels periodic/retry timers, aborts an active attempt where supported,
and sends at most one final envelope;
remaining data is discarded because teardown is best effort. Await `flush()`
before disposal when deterministic completion is required.

Envelopes are at most 48 KiB of uncompressed UTF-8, with at most 16 variants per
feature. Admission reserves eventual numeric chunks within 2,000 entries and
256 KiB globally, counting pending, sealed, in-flight and retry data, including
UTF-8 routing and attribution metadata. Context changes never multiply this budget. This conservative reservation may
reject new events before a densely combined envelope reaches those limits.
Accepted queued data is not evicted to admit new data. Individual entries too
large for an envelope are rejected. No telemetry is persisted.

The wire body contains `k` (app key), `e` (environment), `f` (feature variant
counts) and `m` (application metrics), plus optional `i` (minted instance id)
or `u` (client identity when `instanceId` is not set). It contains no groups,
claims, entity, timestamps or metric kind. Optional `onDiagnostic` receives at
most ten payload-free diagnostic codes per reporter; callback exceptions are
swallowed.

## Context changes and replacement

`setContext({ appKey?, environment?, instanceId?, identity? })` is synchronous.
Omitted or `undefined` routing fields (`appKey`, `environment`) preserve their
current values. Attribution is replaced: omitted, `undefined` or blank
`instanceId`/`identity` clears that field; nonblank values are trimmed. A nonblank
`instanceId` sends only `i`, otherwise a nonblank `identity` sends `u`.
Unknown fields are ignored; malformed non-string values for known fields reject
the whole update with a bounded `invalid-option` diagnostic.

Each accepted aggregate captures its app key, environment and effective
attribution. A change seals nonempty aggregates before accepting new events.
Old queued events, in-flight requests and retries retain their original context;
gauges are sent in order, including when a context is revisited. Retries reuse
the original serialized transport bytes. Equivalent effective contexts do not
split aggregates, and transitions without accepted data retain no history.

An initially keyless reporter can be activated with `setContext({ appKey })`.
A blank key stops new admissions and detaches browser listeners; previously
accepted data can still flush with its original key. Scheduling stops once that
data drains. Supplying a valid key starts scheduling again; call
`attachBrowserLifecycle(reporter)` again if browser events are wanted after
activation. `enableTelemetry: false` remains disabled for the reporter lifetime,
and disposed reporters cannot be reactivated.

When replacing a reporter because transport settings or opt-out changed, call
`oldReporter.dispose({ flush: false })` **before** constructing the replacement.
This immediately discards every pending partition, cancels retry/request timers,
settles outstanding flush promises and aborts active transport where supported.
It also cancels an earlier default disposal. Delayed compression and late
transport completion cannot cause another send or retry. Abort cannot establish
whether the server already received a request. This replacement path keeps one
active reporter budget and avoids accumulating retiring reporters. Use
`setContext` for ordinary identity/token/routing changes instead of replacing
the reporter. Transport settings are fixed at construction.

SDK evaluator integrations can call the internal `captureCheck()` before
invoking host callbacks. Its returned `(featureKey, variant) => void` records a
check afterward using that owner's captured attribution, even if a callback
changed the current context. Pass the evaluated feature/variant snapshot, not
replacement definitions. The recorder does not change current context or
reserve queue space until invoked; admission uses the same validation and global
budget. It becomes a no-op after disposal and cannot record on another reporter.
Keep this seam inside SDK evaluators rather than exposing it as a consumer API.

The server's application setting `AcceptClientGeneratedIdentitiesForMetrics`
is off by default and controls whether client-asserted `u` is accepted. Unknown
or expired `i` and unaccepted `u` can be ingested without identity while still
returning HTTP 202; acknowledgment is not proof of attribution acceptance.
Host-supplied `i` is minted by a trusted backend, never by this reporter.

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
