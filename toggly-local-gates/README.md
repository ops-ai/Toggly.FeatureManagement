# @ops-ai/toggly-local-gates

Pure TypeScript helpers for **device-local post-filter gates** on Toggly client SDK feature flags.

Worker-evaluated booleans from `evaluated-signed` are combined at read time:

```
effective(key) = remote(key) AND localPrerequisite(key)
```

Use this package from Toggly client SDKs or app code that needs consistent gate logic without mutating cached remote flags.

## Install

```bash
npm install @ops-ai/toggly-local-gates
```

## Usage

```typescript
import {
  buildFlagGateIndex,
  applyLocalGate,
  type LocalGate,
} from '@ops-ai/toggly-local-gates';

const gates: LocalGate[] = [{
  id: 'apiRedesign',
  flagKeys: ['ApiV2Checkout', 'ApiV2Profile'],
  isEnabled: () => settings.apiRedesignEnabled,
}];

const gateIndex = buildFlagGateIndex(gates);
const remote = toggly.isFeatureOn('ApiV2Checkout'); // remote only, before post-filter
const effective = applyLocalGate(remote, 'ApiV2Checkout', gates, gateIndex);
```

See [Toggly SDK docs](https://docs.toggly.io/sdks/client-side/post-filter) for the full cross-SDK pattern.

## Monorepo development

Sibling packages in this repository use a `file:` dependency pointing at this package (for example `file:../../toggly-local-gates`). Run `npm run build` here before installing dependents.

## Publishing

Publish **`@ops-ai/toggly-local-gates` first**, then set dependent packages to:

```json
"@ops-ai/toggly-local-gates": "^1.0.0"
```

Do not ship `file:` paths in published npm artifacts.
