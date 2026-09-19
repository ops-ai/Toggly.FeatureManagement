# .NET client SDK

Use `Toggly.FeatureManagement.Client` in distributed .NET applications with a **frontend App Key**. The portable core targets .NET 8 and has no ASP.NET Core or Generic Host dependency. `Toggly.FeatureManagement.Client.Desktop` adds native ES256 verification and filesystem snapshots for console and desktop hosts.

Use the [trusted .NET server SDK](https://docs.toggly.io/sdks/dotnet) for backend definitions, authenticated targeting, middleware, metrics and server-side enforcement. This client fetches evaluated-signed booleans and EntityGates. Client-controlled identities and feature gates do not authorize access to protected resources.

## Install and initialize

```sh
dotnet add package Toggly.FeatureManagement.Client.Desktop --version 3.10.0
```

```csharp
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;

using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
await using var client = DesktopClient.Create(new TogglyClientOptions
{
    AppKey = Environment.GetEnvironmentVariable("TOGGLY_APP_KEY"),
    Environment = "Production",
    Context = new EvaluationContext("user-123", ["beta"],
        new Dictionary<string, string> { ["plan"] = "premium" }),
    Defaults = new Dictionary<string, bool> { ["new-dashboard"] = false }
}, http);

client.Error += (_, error) => Console.Error.WriteLine(error.Message);
client.Changed += (_, _) => Console.WriteLine("Features or context changed");
await client.InitializeAsync();
if (client.IsEnabled("new-dashboard"))
    Console.WriteLine("Show the new dashboard");
```

`InitializeAsync` awaits the first refresh attempt, then `IsReady` is true even when the network failed and defaults are in use. Missing/blank App Key deliberately selects offline defaults without network requests. Subscribe to `Error` before initialization to report connectivity, verification and storage failures. The caller owns `HttpClient`; dispose the client before disposing HTTP resources.

## Feature checks and local prerequisites

```csharp
bool both = client.Evaluate(["new-dashboard", "api-v2"]);
bool either = client.Evaluate(["new-dashboard", "api-v2"], Requirement.Any);
bool fallback = client.Evaluate(["new-dashboard"], negate: true);
```

Unknown keys use their configured default, otherwise false. Empty key lists return true before negation. Negation applies after all/any evaluation.

Set `LocalGates` to a dictionary mapping a flag to a synchronous `Func<bool>`. For example, `["enhanced-submit"] = () => deviceIsReady`. A local prerequisite is ANDed with the worker/entity result at every read, so it can turn a flag off but cannot turn a remotely disabled flag on. A throwing prerequisite fails closed and reports `Error`. Notify your UI when your device state changes; the SDK does not observe arbitrary application variables.

## Identity, groups and claims

```csharp
await client.SetContextAsync(new EvaluationContext(
    "another-user", ["staff"],
    new Dictionary<string, string> { ["role"] = "editor" }));
```

A client represents one user session. Create separate clients for independent sessions. Context updates clear the previous flags and revision before fetching, and reject stale in-flight responses from the previous context. Input collections are copied. Groups are deduplicated and sorted; claims are sorted and limited to 20 types. Identity, groups and claims become `u`, repeatable `g`, and `claim.*` query parameters; use opaque IDs and coarse, non-sensitive rollout dimensions.

User targeting, percentage, claims, time and request-derived filters execute on the definitions worker. Native desktop requests do not supply browser fingerprints or spoof geographic signals through this API.

## Entity checks

```csharp
var order = new EntityContext("Order", "ord-vip",
    new Dictionary<string, object?> { ["Vip"] = true, ["Total"] = 250 });
bool checkout = client.IsEnabled("ExpressCheckout", order);
```

An EntityGate without entity context fails closed, even when a default is true. Attributes are resolved with exact then case-insensitive property lookup. Supported operators are `eq`, `neq`, `in`, `contains`, `gt`, `gte`, `lt`, and `lte`; ordered comparisons require number or datetime type. String comparisons ignore case. Empty, malformed and unsupported rules fail closed. Per-read entity context permits different Orders in different views without changing the user session.

## Signatures and persistence

All remote responses require ES256 verification. The exact raw `defs` JSON plus `|` plus Unix timestamp is double SHA-256 hashed, matching the definitions worker. Both P1363 and DER signatures are accepted by the desktop verifier. JWK curve, algorithm, key coordinates and key fingerprint are checked. `AllowedKeyIds` can restrict the accepted keys. `MaximumSignatureAge` defaults to 30 days; timestamps over five minutes in the future and rollback timestamps are rejected.

Pass a directory as the third `DesktopClient.Create` argument to enable `FileSnapshotStore`. Restrict that directory to the current OS user. The store writes envelopes atomically under a SHA-256 context key covering endpoint, app, environment and complete evaluation context. Snapshot loads validate context and reverify signatures; malformed data never replaces last-known-good memory state.

After an accepted HTTPS response, the snapshot retains the original signed envelope and the exact public JWKS that verified it, including a successful signing-key rotation. A fresh client restores and reverifies this state before attempting network access. The current context, allowed key IDs and maximum signature age still apply; expired, malformed or unverifiable snapshots fall back to defaults. Previously verified in-memory flags remain available during network errors; maximum signature age is checked when accepting envelopes, not a forced expiration of last-known-good memory.

`TrustedJwks`, when supplied out of band, is authoritative: neither endpoint nor persisted keys may replace it. Without explicit pins, offline restore relies on the host protecting its cache directory. A signature checked against keys stored beside the envelope cannot defend against an attacker replacing both. Use `TrustedJwks` or independently pinned `AllowedKeyIds` where that threat applies. No private key or secret is stored. A running client never replaces already observed verification keys with older context-cache keys. A fresh process has no cross-context revocation ledger: historical context snapshots may remain usable within the age limit unless current independently configured trusted keys or allowed key IDs exclude their signing key. Offline caching does not promise immediate key revocation.

Custom stores must round-trip all `ClientSnapshot` properties. Format version 2 includes `TrustedJwks`; legacy version 1 remains readable when trusted keys are already available. Unsupported versions are ignored safely.

Implement `ISnapshotStore.LoadAsync(contextKey, cancellationToken)` and `SaveAsync(contextKey, snapshot, cancellationToken)` for alternate storage. Do not persist flattened entity decisions, since those belong to individual reads.

## Live updates and host lifecycle

`EnableLiveUpdates` defaults to true. WebSocket notifications invalidate the cache; full legacy WebSocket payloads are ignored. The client accepts JSON notifications and plaintext `update`/`flags-updated`, coalesces changes over 300 ms, and refreshes with full context. Notification-triggered requests bypass conditional headers and include `rev` when provided; routine refreshes can use the last HTTP-confirmed revision. Superseded refreshes are cancelled and drained. Connections retry with backoff from 5 to 60 seconds. Polling every five minutes (`RefreshInterval`) continues as a fallback. A signing-key notification refreshes both JWKS and definitions. A verification failure also retries fresh endpoint keys once, covering missed rotation notifications.

`RefreshAsync`, `InitializeAsync` and `SetContextAsync` accept cancellation tokens. `DisposeAsync` cancels requests, stops polling, closes subscriptions and removes event handlers. Notifications can run on I/O threads: Avalonia callers should use `Dispatcher.UIThread.Post`, and other desktop hosts should marshal to their own UI dispatcher. Avoid synchronously blocking on async lifecycle methods from callbacks.

## Portable host integration

The core constructor accepts `TogglyClientOptions`, a caller-owned `HttpClient`, mandatory `ISignatureVerifier`, optional `ISnapshotStore`, and optional `IUpdateSource`. Browser hosts can supply WebCrypto and browser storage adapters without importing the desktop package. A signature verifier must validate the exact signed bytes and JWK fingerprint; returning true unconditionally removes the trust boundary. `WebSocketUpdates` can take a host connection factory when custom WebSocket construction is needed.

| Surface | Support |
| --- | --- |
| Console and desktop .NET 8+ | Native desktop package |
| ASP.NET / Generic Host required | No |
| Boolean, all/any/negate, defaults | Yes |
| Identity/groups/claims and EntityGate | Yes |
| Device-local post-filter prerequisites | Yes |
| Signed snapshots and WebSocket invalidation | Yes |
| Experiment variant assignment | Not exposed by this boolean client |
| Usage metrics and server middleware | Use the trusted server SDK |
| Browser-native storage / UI components | Supplied by a browser adapter |

## Samples and development

The [console and Avalonia showcase](https://github.com/ops-ai/Toggly.Samples/tree/develop/dotnet-client-sdk) covers startup, offline behavior, context changes, gates, entity context and UI-thread-safe events.

From `Toggly.FeatureManagement.Client`:

```sh
dotnet test tests/Toggly.FeatureManagement.Client.Tests -c Release --collect:"XPlat Code Coverage" --settings coverage.runsettings
dotnet pack src/Toggly.FeatureManagement.Client -c Release
dotnet pack src/Toggly.FeatureManagement.Client.Desktop -c Release
```

MIT license. Learn more at [toggly.io](https://toggly.io).

## Frontend telemetry

Keyed clients enable telemetry by default; set `EnableTelemetry = false` to opt out. Keyless clients stay silent. Configure `MetricsBaseUrl` separately from definitions and set `TelemetryFlushIntervalMs` to 30000–60000 (default 45000, with ±20% jitter). Invalid intervals fall back; invalid HTTP(S) URLs, credentials, query or fragment disable telemetry without affecting evaluation.

```csharp
client.RecordUsage("checkout");
client.RecordView("checkout", "experiment-a");
client.IncrementCounter("orders", 2);
client.SetGauge("cart_total", 12.5);
await client.FlushTelemetryAsync();
// Forward a native application's background transition:
await client.FlushTelemetryAsync(keepalive: true);
```

Automatic checks count only actual evaluated leaves after entity/local gates and before aggregate negation. Short-circuited keys and internal refresh/snapshot work do not count. Explicit events do not reevaluate flags. Variants accept 1–64 ASCII letters, digits, underscores or hyphens. This client exposes Boolean evaluation; it does not expose an assigned-variant evaluation API.

Payloads contain only public app key, environment and aggregate counts/metric values. Identity, groups, claims and entity data are excluded. Telemetry uses its own HTTP client, never definitions authentication, and never persists events. The caller retains ownership of its definitions `HttpClient` and any optional `IFrontendTelemetryTransport`.

Buffers include inflight/retry data and numeric chunks within 2000 entries / 256 KiB; each envelope is at most 48 KiB. Ordinary sends use gzip with pre-send plain fallback. Only 429/503 responses retry, at most twice after 30/60 seconds (longer Retry-After honored), within 5 minutes. Ambiguous failures drop. `DisposeAsync` cancels schedules and attempts at most one final plain envelope within a global 5-second bound. `OnTelemetryDiagnostic` receives each fixed code at most once per client lifetime, without payloads. Cancelling an explicit telemetry flush ends that wait without throwing or cancelling a shared send.

### Minted identity and login/logout

`TogglyClientOptions.InstanceId` accepts a capability minted by your trusted backend. Definitions use `?i=` and omit client identity, groups and claims; telemetry sends the same token as JSON `i`. Without a token, definitions retain existing targeting and telemetry sends optional `u`. The app setting for accepting client-generated metric identities is off by default; an HTTP 202 does not confirm that identity was accepted.

Use `IFrontendIdentitySession.SetIdentityAsync(context, instanceId)` on `TogglyClient` or `BrowserFeatureSession` to replace the context and token atomically. Pass null to clear the token. Existing `SetContextAsync(context)` always clears the previous token, including login/logout from Blazor's authentication provider. Supply the replacement token after authenticating the new user; never reuse the old user's token.

Events already accepted retain their original identity, including retries and gauges. All identities share one bounded in-memory queue and one request owner. Token changes partition signed snapshots and conditional requests. Trusted Blazor Server sessions keep their existing server-side identity behavior and do not implement the frontend companion.
