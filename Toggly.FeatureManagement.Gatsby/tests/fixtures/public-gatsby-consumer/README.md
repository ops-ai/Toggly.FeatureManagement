# Gatsby public-package telemetry acceptance fixture

This SDK test fixture is a Gatsby 5 / React 18 host that installs the published
`@ops-ai/gatsby-feature-flags-toggly@1.10.0` package from npm. It exercises the
published Gatsby plugin, hooks, computed stores, gate components, and compact
browser telemetry without sending requests to Toggly services. It is a focused
installed-consumer test, not a Samples teaching page.

The production build uses build-time defaults and does not start a browser
reporter. The browser probe points definitions and telemetry at a local test
collector on `127.0.0.1:8838`; the page is served at `127.0.0.1:8837`. The
collector decodes JSON and gzip requests and records request headers, raw body,
and decoded body. It never forwards traffic. The fixture waits for Gatsby's root
provider, then uses the published `initTogglyClient` API to configure a local
gate before mounting its interactive probe; the Gatsby plugin's published
options schema does not accept the `localGates` option.

Run with Node 22 or newer:

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:cleanup
npm run test:e2e
```

The browser run checks direct and React flag evaluation, `any` short-circuit
and `all` gates, negation, local and entity gates, explicit usage/view and
counter/gauge APIs, hidden-page flushing, a `503` retry, telemetry owner
replacement, opt-out, keyless operation, SSR silence, and that all browser
requests stay on the local hosts. It prints the decoded packet and observed
`i`/`u` fields as evidence. The approved packet contract requires `k/e/f/m`
and permits optional `i/u` as attribution, not authentication.

The cleanup regression starts real Gatsby, collector, and Chromium processes.
It checks failed browser launch/connection and a pre-shutdown browser close
rejection or stall. Each runner must exit unsuccessfully on its own, with the
Chromium PID gone and both local ports closed.
