import type { FilterEvaluator } from './types'
import { computePercentile } from './hash'
import { registerSegmentFilters } from './segment'
import { asBool, asFloat, asString, collectIndexedValues } from './params'

export { asBool, asFloat, asString, collectIndexedValues } from './params'

function parseTime(s: string): Date | undefined {
  const t = Date.parse(s)
  if (Number.isNaN(t)) {
    return undefined
  }
  return new Date(t)
}

function contains(list: string[], val: string, ignoreCase: boolean): boolean {
  for (const s of list) {
    if (ignoreCase) {
      if (s.toLowerCase() === val.toLowerCase()) {
        return true
      }
    } else if (s === val) {
      return true
    }
  }
  return false
}

export const alwaysOn: FilterEvaluator = () => true
export const alwaysOff: FilterEvaluator = () => false

export const percentage: FilterEvaluator = (featureKey, params, ctx) => {
  let pct = asFloat(params, 'Value')
  if (pct === undefined) {
    pct = asFloat(params, 'Percentage')
  }
  if (pct === undefined || pct <= 0) {
    return false
  }
  if (pct >= 100) {
    return true
  }
  if (!ctx.identity) {
    return false
  }
  return computePercentile(ctx.identity, featureKey) < pct
}

let timeWindowNow: (() => Date) | undefined

/** Test hook to pin TimeWindow "now". */
export function setTimeWindowNow(fn: (() => Date) | undefined): void {
  timeWindowNow = fn
}

export const timeWindow: FilterEvaluator = (_featureKey, params, _ctx) => {
  // Definitions parity: each side is optional; missing side is unconstrained;
  // neither Start nor End → true; invalid present side fails closed.
  const startS = asString(params, 'Start')
  const endS = asString(params, 'End')
  const now = (timeWindowNow?.() ?? new Date()).getTime()

  if (startS) {
    const start = parseTime(startS)
    if (!start || now < start.getTime()) {
      return false
    }
  }

  if (endS) {
    const end = parseTime(endS)
    if (!end || now > end.getTime()) {
      return false
    }
  }

  return true
}

export const targeting: FilterEvaluator = (featureKey, params, ctx) => {
  // Match Definitions default: IgnoreCase defaults to true when unset.
  const ignoreCase = asBool(params, 'IgnoreCase') ?? true
  const identity = ctx.identity ?? ''
  const groups = ctx.groups ?? []

  const exclusionUsers = collectIndexedValues(params, [
    'Audience.Exclusion.Users',
    'Audience:Exclusion:Users',
  ])
  if (identity && contains(exclusionUsers, identity, ignoreCase)) {
    return false
  }

  const exclusionGroups = collectIndexedValues(params, [
    'Audience.Exclusion.Groups',
    'Audience:Exclusion:Groups',
  ])
  if (
    groups.length > 0 &&
    exclusionGroups.some((g) => contains(groups, g, ignoreCase))
  ) {
    return false
  }

  if (identity) {
    const users = collectIndexedValues(params, [
      'Audience.Users',
      'Audience:Users',
    ])
    if (contains(users, identity, ignoreCase)) {
      return true
    }
  }

  if (groups.length > 0) {
    const audienceGroups = collectIndexedValues(params, [
      'Audience.Groups',
      'Audience:Groups',
    ])
    for (const g of groups) {
      if (contains(audienceGroups, g, ignoreCase)) {
        return true
      }
    }
  }

  let pct = asFloat(params, 'Audience.DefaultRolloutPercentage')
  if (pct === undefined) {
    pct = asFloat(params, 'Percentage')
  }
  if (pct === undefined || pct <= 0) {
    return false
  }
  if (pct >= 100) {
    return true
  }
  if (!identity) {
    return false
  }
  return computePercentile(identity, featureKey) < pct
}

export function createDefaultRegistry(): Map<string, FilterEvaluator> {
  const reg = new Map<string, FilterEvaluator>()
  const register = (names: string[], ev: FilterEvaluator) => {
    for (const name of names) {
      reg.set(name, ev)
    }
  }
  register(['AlwaysOn'], alwaysOn)
  register(['AlwaysOff'], alwaysOff)
  register(['Percentage', 'Microsoft.Percentage'], percentage)
  register(['TimeWindow', 'Microsoft.TimeWindow'], timeWindow)
  register(['Targeting', 'Microsoft.Targeting'], targeting)
  registerSegmentFilters(reg)
  return reg
}

/** Exported for tests that need bucket values. */
export { computePercentile, identityBucket, rolloutBucket } from './hash'
