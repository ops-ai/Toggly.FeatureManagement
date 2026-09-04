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
