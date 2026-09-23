# @ops-ai/toggly-eval

Local feature-definition evaluation for Toggly **server** SDKs.

Fetches use `GET /definitions-signed/{appKey}/{environment}`; this package
evaluates the returned `FeatureDefinition[]` rules with identity, groups,
claims/traits, and optional entity context.

Browser / client SDKs continue to use `evaluated-signed` and do not depend on
this package.

## Release note

Publish this package **before** dependent server SDKs that declare
`@ops-ai/toggly-eval`. In the monorepo, dependents may temporarily use
`file:../toggly-eval` (or `file:../../toggly-eval`); switch those to `^1.0.0`
after the first npm publish.

## Usage

```ts
import {
  evaluateDefinition,
  evaluateDefinitions,
  evaluateFeatureGate,
  indexDefinitions,
  type FeatureDefinitionModel,
  type EvalContext,
} from '@ops-ai/toggly-eval'

const defs = indexDefinitions(definitionsArray)

const ctx: EvalContext = {
  identity: 'user-123',
  groups: ['beta'],
  entity: { kind: 'Order', key: '1', attributes: { Color: 'red' } },
}

const on = evaluateDefinitions(defs, 'my-flag', ctx)
```

## Filters

Mirrors the Go server SDK:

- `AlwaysOn` / `AlwaysOff`
- `Percentage` (identity-bucketed)
- `TimeWindow`
- `Targeting` (users, groups, default rollout %)
- `ContextProperty` (entity attributes; fail-closed without entity)

## Feature variants (catalog-local, MF-parity)

`allocateVariant` assigns a variant for one `FeatureDefinitionModel` given a
`variants` list and an `allocation` policy (user / group / percentile /
defaults), entirely from locally cached definitions — no server round trip.
The algorithm replays `Microsoft.FeatureManagement` 4.7.0's own
variant-assignment logic bit-for-bit (verified against the shared gold
corpus at `variant-allocator-corpus/cases.json`, repo root), including its
SHA-256 percentile hashing, `statusOverride`, and default-when-enabled/
disabled fallbacks.

```ts
import { allocateVariant, type FeatureDefinitionModel } from '@ops-ai/toggly-eval'

const def: FeatureDefinitionModel = {
  featureKey: 'checkout-flow',
  filters: [{ name: 'AlwaysOn' }],
  variants: [
    { name: 'A', configurationValue: { color: 'blue' } },
    { name: 'B', configurationValue: { color: 'green' } },
  ],
  allocation: {
    defaultWhenEnabled: 'B',
    user: [{ variant: 'A', users: ['alice', 'bob'] }],
  },
}

const result = allocateVariant(def, { identity: 'alice' })
// { variantName: 'A', configurationValue: { color: 'blue' }, enabled: true, assignmentReason: 'User' }
```

`enabled` reuses this package's own `evaluateDefinition`, so a feature's
boolean state and its variant assignment are always consistent with
`isFeatureOn`/`evaluateFeatureGate`.

`IgnoreCase` defaults to `false` here (matching
`Microsoft.FeatureManagement.Targeting.TargetingEvaluationOptions`), which is
deliberately different from this package's own `Targeting` filter (defaults
`true`). Pass `{ ignoreCase: true }` as the third argument to opt in.
