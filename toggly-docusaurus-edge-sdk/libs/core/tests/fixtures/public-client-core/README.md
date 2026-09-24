# Public client-core browser acceptance fixture

This isolated Vite fixture imports published `@ops-ai/toggly-client-core@0.5.1`
directly. It tests the generic client owner independently of the Docusaurus
plugin. The lockfile resolves the SDK and its telemetry reporter from the
public npm registry; the fixture has no workspace alias or local SDK source
import. It is acceptance infrastructure, not a Samples teaching page.

## Run

```bash
cd toggly-docusaurus-edge-sdk/libs/core/tests/fixtures/public-client-core
cp .env.example .env.local
npm ci
npm run dev
```

With no key, the direct `On` check uses a local default and creates no
frontend telemetry reporter. To exercise a real application, set
`VITE_TOGGLY_APP_KEY` to a **Frontend** key for an application whose allowed
origins include the Vite URL. The configured environment is `Production`.
`VITE_` values are embedded in the browser bundle; never put a management or
Backend secret there. Set `VITE_TOGGLY_SECOND_APP_KEY` only if you want to
exercise the two-client isolation button with a second authorized application.

The direct button evaluates one flag. The gate buttons show short-circuit
evaluation, a local precondition that does not evaluate a flag when false,
and aggregate negation after the evaluated check. The entity button evaluates
the same remotely supplied Order rule for VIP and standard orders.
`getFlags()` refresh and projection are not feature checks; each `getFlag()`
call is. This generic client has no public assigned-variant lookup, so the
variant button records an **explicit** `treatment` usage and view without an
extra check. The ordinary explicit-events button records default `enabled`
usage/view, adds two to the `orders` counter and sets the latest `cart` gauge.
`flushTelemetry()` is awaitable; dispose begins one best-effort final flush.

The context button switches this client to Bob; the browser test starts from
Alice to prove queued telemetry keeps its original context, while subsequent
checks use Bob's definitions.
In published 0.5.1, identity can appear as optional `u` in the telemetry
envelope. The approved wire contract requires `k/e/f/m` and permits optional
`i/u`; these fields are attribution, not authentication.
Browser hidden/pagehide sends are best effort and use uncompressed keepalive
requests. Ordinary flushes prefer gzip and fall back to JSON. Only explicit
429/503 responses retry, at most twice; ambiguous failures and other errors
are dropped to avoid duplicate ingestion.

## Local acceptance

```bash
npm ci
npm test
npm run build
```

The browser test supplies placeholder keys and intercepts definitions and
`https://metrics.toggly.io/api/frontend/telemetry` in Chromium. It verifies
the real public package's packets, opt-out/keyless silence, context and client
isolation, gzip/plain requests, 429/503 retries, terminal failures, and
pagehide/disposal. It never sends production telemetry. The Node test imports
the portable root and verifies SSR silence. These tests establish local
public-package behavior, not a deployed POST or Victoria Metrics aggregation.
