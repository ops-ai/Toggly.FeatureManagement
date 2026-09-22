## [1.16.0] - 2026-09-21

## [1.17.0] - 2026-09-22

### Added
- Integration-only `browserEnableUsageTracking` and `browserEnableMetrics`
  options let applications enable or disable browser categories independently
  of trusted server usage. Omitted overrides inherit the existing shared
  settings; `enableTelemetry` remains the browser master opt-out.


### Added
- Shared browser telemetry across React, Vue, Svelte and native Astro client components, enabled by default with an app key and configurable collector/interval/opt-out.
- Explicit usage, view, counter, latest-value gauge and awaitable flush methods; synchronous browser client disposal with bounded final flushing.

### Fixed
- Preserve explicit Node definitions initialization while frontend telemetry, polling, WebSocket and lifecycle resources remain browser-only.
- Remove inherited instance tokens when a context starts without a token or explicitly clears it, keeping definitions and telemetry attribution aligned.
- Append definitions endpoints to the configured URL pathname and suppress all pre-existing client targeting query fields when a minted token is supplied.
- Snapshot nested entity rules before callbacks and stop superseded refresh hooks before they publish retired results.
- Count effective checks and assigned variants once through the shared evaluator, preserving local/entity gates and short circuit.
- Avoid telemetry from unobserved computed-store maintenance or duplicate native component hydration subscriptions.
- Apply local gates to framework variant helpers and forward native component entity context.
- Isolate app/environment replacement and prevent delayed initialization or refresh from restoring disposed resources.

### Changed
- Forward host-provided `instanceId` as `i`, otherwise `identity` as `u`, using public shared reporter 1.1.0. Minted definitions targeting suppresses user/groups/claims; server/build telemetry ownership remains unchanged.
- Compatible browser initialization and existing identity methods preserve admitted event/retry attribution in one bounded reporter. Transport replacement cancels/discards old unsent events; final disposal retains bounded flushing.
- Count each Vue gate refresh once even while Nano Stores retains unobserved projections; mixed-island refresh remains current during pending hooks.
- Capture owner, assigned variant and local gates before host callbacks. Fence reentrant publication and stale context responses.
- Retain validators only with the active matching in-memory definitions body; remove legacy persisted orphan revisions. Context/mode transitions and cold starts fetch full bodies, and failed transitions cannot restore retired-user flags.

## 1.15.1

2026-09-17

### Fixed
- Default usage/metrics HTTPS host is `https://metrics.toggly.io/`.

## 1.15.0

2026-09-15

### Added
- Astro 6 and 7 compatibility alongside retained Astro 5, including packed
  SSR/SSG hosts, middleware, page gates, and React/Vue/Svelte island checks.
- Compatibility with Nano Stores React 2 while retaining version 1.
- Vite `x-feature` transform handles query/hash-suffixed module ids from
  Vite 7/8 (Astro 6/7) while still matching bare `.astro` paths.

### Fixed
- Keep SDK definition-request headers off public JWKS lookups so signed
  browser evaluation does not trigger an unnecessary CORS preflight.
- Include the advertised Vue and Svelte public entry points and declarations
  in the published artifact so island helpers resolve in consuming builds.
- Compile both Svelte gate components with valid import aliases and native
  store subscriptions, so readiness, local gates, and remote refresh update
  their rendered content and slot values.

- Keep a single browser store during development by excluding the SDK from
  partial dependency prebundling; source components and helper imports now
  observe the same readiness and flag updates.

- Preserve the server loading snapshot while React and Vue islands hydrate, including
  when signed flags finish loading before hydration starts.

### Changed
- Require published signed-defs 1.2.8 or newer so canonical Node/browser
  signatures and public JWKS requests use the corrected shared verifier.
- Synchronize SDK identity and User-Agent with package version 1.15.0.

## 1.14.0

2026-09-10

### Added
- Minimal HTTPS usage telemetry on the SSR server client (`POST api/usage/stats`)
  with `definitionCacheHits` / `definitionCacheMisses` for definition-refresh
  outcomes (TTL skip, network apply, error+last-good) [OPS-996].
- Soft-fail restore on usage flush failure; `TOGGLY_DISABLE_TELEMETRY=1` kill
  switch; cache-only batches flush without feature check stats.

### Changed
- Sync `SDK_VERSION` with the package version (`1.14.0`); User-Agent
  `toggly-astro/1.14.0`.
- Request-scoped `createTogglyMiddleware` clients disable process signal
  handlers by default, skip the periodic flush timer unless configured, and
  `close()` when the request finishes (avoids listener/timer leaks).
- Usage `appVersion` is only the configured consuming-app version (never
  defaulted to `SDK_VERSION`; SDK identity remains User-Agent / headers).
- Bound request-scoped middleware `close()` wait (`REQUEST_SCOPED_CLOSE_TIMEOUT_MS`)
  so a hung usage flush cannot stall the HTTP response indefinitely.
- HTTPS usage client aborts posts after `DEFAULT_TELEMETRY_FETCH_TIMEOUT_MS`
  (5s) so long-lived servers are protected from stalled telemetry endpoints.
- Timed-out `close()` leaves flush/cleanup running in the background so soft-fail
  restore cannot race a nulled usage batcher (Seer).

### Notes
- Browser `src/client/store.ts` island refresh instrumentation is out of scope.
- Full `Metrics.SendMetrics` parity is deferred (not an OPS-911 clone).
- Server N/A: WebSocket live updates, durable snapshot hydrate, HTTP 304 /
  equal-revision etag (no If-None-Match on the SSR client).

## 1.13.0

2026-09-03

### Added
- Forward config `claims` as EvalContext.claims for UserClaims filters on
  the local-eval server rail [OPS-874].

## 1.12.0

2026-09-03

### Changed
- Removed disabled-branch `fallback` slot/prop from Feature components (Astro, React, Vue, Svelte islands).
  Use `negate` for the off path. Use `loading` on the React island for not-ready placeholders.

### Added
- Optional `context` / `contextKind` on Feature components and FeatureGateBuilders.

## 1.11.0

2026-09-02

### Changed
- Server client fetches `definitions-signed` (no identity query) and
  evaluates with `@ops-ai/toggly-eval` at `getFlag` / `evaluateGate`
  (OPS-825). Browser client remains on `evaluated-signed`.
- `enableVariants` still uses `evaluated-variants-signed` for remote
  variant assignment.
- Local evaluation depends on `@ops-ai/toggly-eval@^2.0.0` SHA-256
  sticky buckets (cohort shift vs FNV / eval 1.x) [OPS-832].

### Added
- Dependency on `@ops-ai/toggly-eval` for local definition evaluation.

## 1.10.0

2026-08-28

### Added
- ETag-aware definitions WebSocket live updates on the browser client store
  (`sync` / `flags-updated` / `signing-key-updated`), 300ms debounced refresh,
  exponential reconnect (5s–60s), and `enableLiveUpdates` (default true).
- Definitions revision cache with `If-None-Match` conditional HTTP fetches;
  when WebSocket is connected, the poll interval acts as a 20-minute fallback.

### Changed
- Align `SDK_VERSION` with the package version for WebSocket and HTTP identity.

## 1.9.1


## 1.9.2

- Normalize public npm metadata for provenance and docs links (no API change).

2026-08-28

### Fixed
- Publish installable semver ranges for `@ops-ai/toggly-hooks-types`,
  `@ops-ai/toggly-local-gates`, and `@ops-ai/toggly-signed-defs` instead of
  `file:` paths that leave unmet dependencies after `npm install`.

## 1.9.0

2026-08-21

### Added
- Entity context evaluation on `getFlag` / `evaluateGate` with optional
  `registerContext` mappers. Entity gates fail closed without context.

## 1.8.1

2026-07-14

### Fixed
- Honor `verifySignatures` on server and client fetches (previously ignored). Uses `@ops-ai/toggly-signed-defs` with JWKS at `/.well-known/jwks`.

### Added
- Consolidate evaluated-signed response helpers into `@ops-ai/toggly-signed-defs`.
- Optional `allowedKeyIds` and `maxSignatureAgeSeconds` on `TogglyConfig` for signature verification.

## 1.8.0

2026-07-07

### Fixed
- Island `<Feature>` wrappers, composables, Svelte store helpers, and `FeatureClient.astro` now evaluate gates through `$gate` / `$flag`, so device-local post-filter gates apply correctly.

### Added
- React island `<Feature render={(enabled) => ...} />` render prop for conditional UI.
- Vue island `FeatureGateBuilder.vue` (scoped slot `{ enabled }`) and Svelte island `FeatureGateBuilder.svelte` (`let:enabled`) for conditional UI parity.

## 1.7.0

2026-07-05

### Added
- `groups` and `claims` options on `TogglyConfig` for server-side evaluated definitions.

### Changed
- Evaluated-signed fetch URLs use `@ops-ai/toggly-hooks-types@^1.3.0` (`appendEvaluationContext`).

## 1.6.1

2026-07-05

### Added
- SDK identity on definitions traffic: `User-Agent` on server HTTP, `X-Toggly-Sdk` / `X-Toggly-Sdk-Version` on browser HTTP, `sdk` + `sdkVersion` query params on WebSocket connect.

# Changelog

## [1.6.0] - 2026-07-03

### Added

- `onError` reports client flag fetch failures to Astro SDK consumers.

### Fixed

- Error fallbacks now update the client error store instead of looking like clean ready/default state.
- Successful refreshes clear the last error after new flags are applied.

## [1.5.0] - 2026-06-28

### Added

- Device-local post-filter gates on the client store: `setLocalGates`, `notifyLocalGatesChanged`, and `$localGatesRevision` so `$flag`, `$gate`, and `$variant` apply a read-time AND via `@ops-ai/toggly-local-gates`.

## [1.1.0] - 2026-01-31

### Added
- Added `allFeaturesEnabledDuringBuild` configuration option to enable all features during static site generation (SSG/build time)
- This allows building static sites with all feature-flagged content included, while edge workers (like Cloudflare Workers) can filter content at runtime based on actual feature flag states
- During development, the plugin continues to use actual feature flags from the Toggly API

### Changed
- Updated `TogglyConfig` interface to include the new `allFeaturesEnabledDuringBuild` option
- Modified `TogglyServer` class to accept a `isBuildTime` parameter and respect the `allFeaturesEnabledDuringBuild` setting
- Enhanced integration hooks to properly handle build-time vs runtime client creation

### Use Cases
This is particularly useful for:
- Sites using edge workers (Cloudflare Workers, Vercel Edge, etc.) to filter content based on feature flags
- Ensuring all feature-flagged content is indexed by search engines during build
- Preventing broken links caused by features being disabled during build
- Maintaining a consistent static build while allowing dynamic feature toggling at the edge

## [1.0.6] - Previous versions
- Initial release with SSR, SSG, and framework support
