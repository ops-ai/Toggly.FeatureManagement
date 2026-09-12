# @ops-ai/toggly-signed-defs

Shared ES256 signed-definitions verification for Toggly browser and Node SDKs.

## Install

```bash
npm install @ops-ai/toggly-signed-defs
```

Dependent packages in this monorepo declare a **registry** range (not `file:`):

```json
"@ops-ai/toggly-signed-defs": "^1.0.0"
```

## Runtime resolution

Keep importing from `@ops-ai/toggly-signed-defs`. Browser-aware bundlers select
the browser ESM condition; Node ESM and CommonJS consumers retain their existing
root import behavior. All three entry points expose the same public API.
Node 18 and newer use the built-in Node WebCrypto provider; browsers use
platform WebCrypto and do not import Node modules.

## Entity context

Evaluated-signed `defs` may mix booleans and `EntityGate` objects (`EvaluatedDefinitions`). This package parses and verifies the envelope; it does not evaluate gates. Consumers resolve gates with `@ops-ai/toggly-hooks-types` (or an SDK wrapper) and per-eval entity context.

## Publishing

Publish **`@ops-ai/toggly-signed-defs` first** (workflow: `sdk-signed-defs-release.yml`), then publish SDKs that depend on it.

Do not ship `file:` paths in published npm artifacts.

## Local development before the package exists on npm

```bash
cd toggly-signed-defs && npm run build && npm link
# in each dependent package:
npm link @ops-ai/toggly-signed-defs
```

After the first registry publish, prefer `npm install` against `^1.0.0`.

## Verification

Use Node 24 for the development tooling. The published Node runtime floor is 18.

```bash
npm run typecheck
npm run build
npm test
npm run test:coverage
npm run test:consumer -- /path/to/node18/bin/node
```

The consumer check installs a packed artifact, compiles TypeScript consumers,
then runs real CJS and ESM files with the current Node runtime and any additional
Node executable paths supplied. It verifies canonical P1363 and DER signatures,
rejects malformed DER, and exercises the browser export condition in the current
Node runtime. The browser condition check does not replace a browser-host test.
