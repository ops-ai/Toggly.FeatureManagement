# Packed React consumers

Run `npm run build`, then `npm run test:consumers` from the SDK directory
with Node 22.12+ and Chrome installed. Set `CHROME_BIN` to the Chrome/Chromium
executable outside macOS's default Google Chrome location.

The verifier packs the SDK once and copies each locked fixture into a fresh
OS temporary directory. Each host installs with `npm ci`, resolves public
ESM/CJS exports, typechecks without ancestor development types, builds with
Vite, and runs SSR plus headless Chrome behavioral assertions. Browser
requests to the fixture-only definitions host are intercepted; no Toggly
account or live service is needed. Nothing is installed from SDK source.

| Host | React and React DOM |
| --- | --- |
| Declared minimum | 18.2.0 |
| Retained React 18 patch | 18.3.1 |
| React 19 current frozen patch (registry checked 2026-09-11) | 19.3.0 |

The mounted StrictMode example uses `createTogglyProvider`, `useContext`,
`useFeatureFlag`, `useFeatureGate`, and `Feature` (children, negate, render).
Assertions cover initial flags, local gate changes, identity targeting,
HTTP refresh, and unsubscribe cleanup after unmount. SSR asserts the shared
provider/context and the documented initial state before effects execute.
Subscription counters wrap the real public subscription methods in fixture
code only; evaluation, requests, and notifications use the packed SDK.

After changing published package contents, rebuild the SDK and run
`npm run test:consumers` from the SDK directory. The verifier packs once into
an OS temporary directory, copies each checked-in fixture there, and preserves
the committed registry locks. Do not suppress integrity checks in `npm ci`.

When validating an unpublished browser-safe signed-definitions candidate, set
`TOGGLY_SIGNED_DEFS_TARBALL` to its exact reviewed tarball. The verifier copies
that artifact only into its temporary packed consumers and keeps the checked-in
lock targeting the required published package. This is local integration
evidence; a normal registry install remains required before release.

Telemetry acceptance uses a second local HTTP origin with real CORS preflight,
POST, native browser gzip i/u attribution and collector decompression, plus plain
keepalive with minted i. Definitions with i suppress client targeting; remounts
restore factory identity without retaining the previous owner token. Assertions cover aggregate
effective checks, explicit usage/view/counter/gauge payloads, no implicit views,
pagehide and final provider unmount flush. Completed temporary hosts are deleted
after each row to keep disk usage bounded. SSR exercises the keyed telemetry API
and confirms no request. No production metrics endpoint is used.

For intermediate integration before the shared telemetry release is published,
set `TOGGLY_CLIENT_TELEMETRY_TARBALL` to its actual reviewed `npm pack` artifact.
The runner regenerates only disposable consumer locks through npm, then uses
`npm ci`; it prints `LOCAL INTEGRATION ARTIFACT`. Checked-in fixture locks remain
unchanged. Final acceptance must regenerate the committed locks from the real
registry and run without the artifact override.

The consumer runner bounds each owned command to three minutes and uses a dedicated process group so failed or hung browser children cannot retain descendants. Cleanup independently closes Chrome and both HTTP listeners, removes the isolated consumers and npm cache, and preserves the original failure alongside cleanup errors. The command runs real child/listener negative controls for launch, assertion, rejected or hung browser shutdown, artifact cleanup, and logging failures before the three registry hosts.
