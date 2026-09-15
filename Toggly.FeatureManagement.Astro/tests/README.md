# Packed Astro host verification

Run `npm ci`, `npm run test:coverage`, `npm run build`, and
`npm run test:package` in the SDK package first. Then run `npm run test:host`
with `ASTRO_MAJOR=5-min`, `5-locked`, `5`, `6`, or `7`. The manifest in the
runner pins each direct host dependency; npm installs with strict engine and
peer resolution. No `--force`, ignored peer conflicts, source alias, or SDK
source copy is used. `HOST_WORKDIR` optionally preserves an evidence directory;
otherwise each run gets a new temporary directory. SDK tarballs have content
hashes in their filenames to prevent reuse of a stale same-version artifact.

Use Node 20.19.6 for 5-min/5-locked, Node 22.23.2 for 5/6, and Node 24.18.0 for
7. Current Node adapter 9.5.5 resolves undici 8, which requires Node 22.19 or
newer; older retained Astro 5 hosts exercise compatible adapter versions on
Node 20. Framework engines govern other valid pairings.

Install Chromium with the fixture's Playwright CLI or set `CHROMIUM_PATH` to
an installed executable. `HOST_PORT` selects the loopback-only test server
port (default 43879); use separate ports for concurrent runs.

The local HTTP fixture generates ephemeral P-256 keys and independently signs
canonical payloads with WebCrypto. It verifies positive signatures/JWKS,
invalid-signature last-good retention, local gates without network traffic,
remote refresh, concurrent request claims, SSR and SSG, manifests, real
React/Vue/Svelte hydration and gate-builder slots, plus Astro dev hooks. Astro 7 dev hosts run one framework at a time because
the current official React/Vue plugins have upstream issue
https://github.com/vitejs/vite-plugin-vue/issues/798; all production hosts
retain combined islands. The Astro 5.0.0 fixture uses React 18.3.1; other
hosts use React 19.2.4. Browser checks reject hydration warnings and errors.
Default flags are false so successful rendering cannot be a fallback false
positive. Telemetry is explicitly disabled only in the test host.

`SIGNED_DEFS_ARTIFACT=/absolute/path/package.tgz` explicitly installs a local
shared verifier candidate in the temporary consumer. Such a run is integration
evidence only, not proof that the dependency is published. Without this
variable, the host uses the SDK's declared registry dependency. Record the
exact dependency mode and artifact hash with results. Never commit generated
consumer manifests or locks containing local tarball paths.

The page fixture uses Markdown `x-feature` frontmatter. Literal `x-feature:`
in Astro TypeScript frontmatter is stripped by the integration's Vite plugin
during build, but Astro's separate language checker reports that syntax
before Vite transforms it. This existing limitation is not hidden with a
checker suppression or presented as supported typechecked syntax. Existing
source integration tests retain the `.astro` transform coverage.

## Public registry verification

Set `SDK_REGISTRY_VERSION` to an exact published Astro SDK version to skip
packing entirely and install that version from public npm. This mode rejects
`SIGNED_DEFS_ARTIFACT` overrides. The runner records resolved Toggly package
versions, registry URLs, and integrities in `registry-evidence.json`, asserts
that all dependencies use registry sources, and repeats installation with
`npm ci` before building or running the host. For example:

```sh
SDK_REGISTRY_VERSION=1.14.0 ASTRO_MAJOR=5 npm run test:host
```

A failed published-version control is evidence of its limitation, not a reason
to weaken peer resolution. Leave `SDK_REGISTRY_VERSION` unset to test a new
packed SDK candidate with public registry dependencies. These are separate
evidence modes; passing the candidate does not publish it. The SDK requires
`@ops-ai/toggly-signed-defs` 1.2.8 or newer for the shared signature and JWKS fixes.
