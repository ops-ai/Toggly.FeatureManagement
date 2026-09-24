import { evaluateDefinition } from './engine'
import { computeContextPercentage } from './hash'
import type {
  EvalContext,
  FeatureDefinitionModel,
  VariantAssignmentReason,
  VariantAssignmentResult,
  VariantDefinition,
} from './types'

export interface VariantAllocatorOptions {
  /**
   * Case-insensitive user/group matching for allocation rules (percentile
   * hashing also lower-cases the userId before hashing when set). Mirrors
   * `Microsoft.FeatureManagement.Targeting.TargetingEvaluationOptions.IgnoreCase`,
   * which defaults to `false` — deliberately different from this package's
   * own `Targeting` filter, whose `IgnoreCase` defaults to `true`.
   */
  ignoreCase?: boolean
}

function equalsCase(a: string, b: string, ignoreCase: boolean): boolean {
  return ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b
}

function findVariant(
  variants: VariantDefinition[],
  name: string | null | undefined,
): VariantDefinition | null {
  if (!name) {
    return null
  }
  return variants.find((v) => v.name === name) ?? null
}

function matchesUser(
  userId: string | null | undefined,
  users: string[],
  ignoreCase: boolean,
): boolean {
  if (!userId) {
    return false
  }
  return users.some((u) => equalsCase(userId, u, ignoreCase))
}

function matchesGroup(
  groups: string[] | null | undefined,
  targetedGroups: string[],
  ignoreCase: boolean,
): boolean {
  if (!groups || groups.length === 0) {
    return false
  }
  return groups.some((g) => targetedGroups.some((t) => equalsCase(g, t, ignoreCase)))
}

/**
 * Matches `TargetingEvaluator.IsTargeted(ITargetingContext, from, to, ignoreCase, hint)`:
 * hash `"{userId}\n{hint}"` (userId lower-cased first when `ignoreCase`), and
 * treat `to === 100` as an inclusive-from, unbounded-above bucket.
 */
function matchesPercentile(
  userId: string | null | undefined,
  from: number,
  to: number,
  ignoreCase: boolean,
  hint: string,
): boolean {
  const id = ignoreCase ? (userId ?? '').toLowerCase() : userId ?? ''
  const percentage = computeContextPercentage(`${id}\n${hint}`)
  if (to === 100) {
    return percentage >= from
  }
  return percentage >= from && percentage < to
}

/**
 * Assign a variant for one feature definition, catalog-locally, by replaying
 * the exact `Microsoft.FeatureManagement` variant-allocation algorithm
 * (user → group → percentile → default, with `statusOverride` able to flip
 * the base enabled state). Bit-for-bit compatible with
 * `variant-allocator-corpus/cases.json` (see that corpus's README for the
 * full behavior matrix and provenance).
 *
 * The base `enabled` state reuses this package's own `evaluateDefinition`
 * (the same filter evaluation `isFeatureOn`/`evaluateFeatureGate` use), so a
 * feature's boolean state and its variant assignment never disagree.
 */
export function allocateVariant(
  def: FeatureDefinitionModel,
  ctx: EvalContext = {},
  options: VariantAllocatorOptions = {},
): VariantAssignmentResult {
  const ignoreCase = options.ignoreCase ?? false
  const variants = def.variants ?? []
  let enabled = evaluateDefinition(def, ctx)

  // Mirrors FeatureManager: the entire variant pipeline is gated on the
  // feature having any variants configured at all.
  if (variants.length === 0) {
    return {
      variantName: null,
      configurationValue: null,
      enabled,
      assignmentReason: 'None',
    }
  }

  const allocation = def.allocation ?? null
  let variant: VariantDefinition | null = null
  let reason: VariantAssignmentReason = 'None'

  if (!allocation) {
    reason = enabled ? 'DefaultWhenEnabled' : 'DefaultWhenDisabled'
  } else if (!enabled) {
    variant = findVariant(variants, allocation.defaultWhenDisabled)
    reason = 'DefaultWhenDisabled'
  } else {
    const userId = ctx.identity ?? null
    const groups = ctx.groups ?? null

    for (const rule of allocation.user ?? []) {
      if (matchesUser(userId, rule.users, ignoreCase)) {
        variant = findVariant(variants, rule.variant)
        reason = 'User'
        break
      }
    }

    if (reason === 'None') {
      for (const rule of allocation.group ?? []) {
        if (matchesGroup(groups, rule.groups, ignoreCase)) {
          variant = findVariant(variants, rule.variant)
          reason = 'Group'
          break
        }
      }
    }

    if (reason === 'None' && allocation.percentile) {
      const hint = allocation.seed ?? `allocation\n${def.featureKey}`
      for (const rule of allocation.percentile) {
        if (matchesPercentile(userId, rule.from, rule.to, ignoreCase, hint)) {
          variant = findVariant(variants, rule.variant)
          reason = 'Percentile'
          break
        }
      }
    }

    if (reason === 'None') {
      variant = findVariant(variants, allocation.defaultWhenEnabled)
      reason = 'DefaultWhenEnabled'
    }
  }

  if (variant?.statusOverride === 'Enabled') {
    enabled = true
  } else if (variant?.statusOverride === 'Disabled') {
    enabled = false
  }

  return {
    variantName: variant?.name ?? null,
    configurationValue: variant?.configurationValue ?? null,
    enabled,
    assignmentReason: reason,
  }
}
