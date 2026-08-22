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
