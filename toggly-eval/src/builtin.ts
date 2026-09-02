import type { FilterEvaluator } from './types'
import { computePercentile } from './hash'

export function asFloat(
  params: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!params) {
    return undefined
  }
  const v = params[key]
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }
  if (typeof v === 'string') {
    const f = Number.parseFloat(v)
    return Number.isFinite(f) ? f : undefined
  }
  return undefined
}

export function asBool(
  params: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  if (!params) {
    return undefined
  }
  const v = params[key]
  if (typeof v === 'boolean') {
    return v
  }
  if (typeof v === 'string') {
    if (v === 'true' || v === 'True' || v === '1') {
      return true
    }
    if (v === 'false' || v === 'False' || v === '0') {
      return false
    }
  }
  return undefined
}

export function asString(
  params: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!params) {
    return undefined
  }
  const v = params[key]
  return typeof v === 'string' ? v : undefined
}

function asStringValue(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

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
  const startS = asString(params, 'Start')
  const endS = asString(params, 'End')
  if (!startS || !endS) {
    return false
  }
  const start = parseTime(startS)
  const end = parseTime(endS)
  if (!start || !end) {
    return false
  }
  const now = (timeWindowNow?.() ?? new Date()).getTime()
  return now >= start.getTime() && now <= end.getTime()
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

/**
 * Collect indexed RavenDB / legacy colon-prefixed parameter values
 * (dotted and colon-form audience keys).
 */
export function collectIndexedValues(
  params: Record<string, unknown> | undefined,
  prefixes: string[],
): string[] {
  if (!params) {
    return []
  }
  const out: string[] = []
  for (const key of Object.keys(params)) {
    for (const prefix of prefixes) {
      if (!key.startsWith(`${prefix}:`)) {
        continue
      }
      const s = asStringValue(params[key])
      if (s) {
        out.push(s)
      }
      break
    }
  }
  return out
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
  return reg
}

/** Exported for tests that need bucket values. */
export { computePercentile, identityBucket, rolloutBucket } from './hash'
