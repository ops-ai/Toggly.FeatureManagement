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

After changing published package contents, rebuild and pack into
`consumer-fixtures/artifacts/toggly-react.tgz`, remove each lock's local
`node_modules/@ops-ai/react-feature-flags-toggly` entry, and run
`npm install --package-lock-only --ignore-scripts` per fixture to refresh the
locked artifact checksum. Do not suppress integrity checks in `npm ci`.
