# Variant allocator gold corpus

This corpus captures ground-truth variant-allocation outcomes from
[`Microsoft.FeatureManagement`](https://www.nuget.org/packages/Microsoft.FeatureManagement)
`4.7.0`. Every Toggly backend SDK (Go, Java, Python, Node, .NET, ...) that
implements catalog-local feature variants should replay `cases.json` against
its own allocator and assert an exact match, so all SDKs stay bit-for-bit
compatible with Microsoft's variant-allocation algorithm (user/group/
percentile allocation, seed hashing, status overrides, defaults).

## Regenerating

```bash
dotnet run --project Toggly.FeatureManagement.NET/Toggly.FeatureManagement.VariantOracle
```

Run from the repo root. The generator (`Toggly.FeatureManagement.NET/Toggly.FeatureManagement.VariantOracle`)
builds each fixture's `FeatureDefinition`, drives the real
`Microsoft.FeatureManagement.FeatureManager.GetVariantAsync`, and writes the
result to `variant-allocator-corpus/cases.json`. The `expected` block in each
case is *not* independently reimplemented - it is read back from
`FeatureManager`'s own returned `Variant` and its evaluation telemetry (the
`FeatureFlag` `ActivityEvent`), so the corpus reflects exactly what
Microsoft.FeatureManagement computed, not a parallel guess at its behavior.

Regenerating is deterministic: every case has a fixed feature definition and
targeting context, and the percentile hash (SHA-256 over
`"{userId}\n{hint}"`) has no external inputs, so `git diff` should be empty
after a clean regen unless the fixtures themselves changed.

## Schema

`cases.json` is a JSON array of case objects:

```jsonc
{
  "id": "string",                       // unique case name
  "feature": {
    "name": "feature-key",
    "enabledFor": [{ "name": "AlwaysOn" }],   // [] means the feature is off
    "variants": [
      {
        "name": "A",
        "configurationValue": { "x": 1 },     // or a scalar, or null
        "statusOverride": "None"              // "None" | "Enabled" | "Disabled"
      }
    ],
    "allocation": {                     // or null: no allocation configured
      "defaultWhenEnabled": "A",        // or null
      "defaultWhenDisabled": "B",       // or null
      "seed": null,                     // or a custom seed string
      "user": [{ "variant": "A", "users": ["u1"] }],
      "group": [{ "variant": "B", "groups": ["g1"] }],
      "percentile": [{ "variant": "A", "from": 0, "to": 50 }]
    }
  },
  "targeting": {
    "userId": "u1",                     // or null
    "groups": ["g1"]                    // [] for none
  },
  "expected": {
    "variantName": "A",                 // or null if no variant was assigned
    "configurationValue": { "x": 1 },   // matches the assigned variant, or null
    "enabled": true,
    "assignmentReason": "User"          // User | Group | Percentile |
                                         // DefaultWhenEnabled | DefaultWhenDisabled | None
  },
  "ignoreCase": true                    // OPTIONAL, omitted defaults to false
}
```

### `ignoreCase` (additive field)

This field is not part of the minimal schema sketch in the tracking issue,
but is required to exercise case-insensitive user/group targeting
(`Microsoft.FeatureManagement.FeatureFilters.TargetingEvaluationOptions.IgnoreCase`).
It is present (`true`) only on cases that specifically test case-insensitive
matching; every other case omits it, and consumers should treat a missing
`ignoreCase` as `false`.

## Behaviors covered

- **User allocation** - direct match, and no-match falling back to
  `defaultWhenEnabled`.
- **Group allocation** - direct match, and no-match falling back to
  `defaultWhenEnabled`.
- **Percentile allocation** - the library's implicit default seed/hint
  (`"allocation\n{featureName}"` when `Allocation.Seed` is `null`), an
  explicit custom seed, and the `to == 100` edge (inclusive-from,
  unbounded-above match per `TargetingEvaluator`).
- **`defaultWhenEnabled`** with no user/group/percentile rules configured.
- **`defaultWhenDisabled`** with the feature off.
- **Case-insensitive user targeting** (`ignoreCase: true`) plus a
  case-sensitive control case with the same inputs, to show the fallback
  behavior when case sensitivity is on (the default).
- **No allocation at all** - both feature-enabled and feature-disabled
  variants. Microsoft.FeatureManagement still reports
  `DefaultWhenEnabled`/`DefaultWhenDisabled` as the reason even though no
  variant is actually assigned (`variantName: null`) because there's no
  configured default to resolve.
- **`statusOverride: Enabled` / `Disabled`** - a variant's status override
  flipping the feature's effective enabled state.
- **Empty targeting context** (`userId: null`, `groups: []`).
- **No variants defined at all** - the assignment pipeline never runs, so
  `assignmentReason` stays at its default, `"None"`.

## Known limitations

- Scalar `configurationValue` round-tripping through
  `IConfigurationSection` re-infers a type from the string value (bool, then
  integer, then floating point, then string). Fixtures avoid values that are
  ambiguous under this inference (e.g. a string that reads as `"true"` or
  `"123"` when a literal string was intended).
