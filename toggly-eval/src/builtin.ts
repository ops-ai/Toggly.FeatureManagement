import type { EvalContext, FilterEvaluator } from './types'
import { identityBucket, rolloutBucket } from './hash'

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

function collectPrefixedStrings(
  params: Record<string, unknown> | undefined,
  prefix: string,
): string[] {
  if (!params) {
    return []
  }
  const out: string[] = []
  const needle = `${prefix}:`
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith(needle)) {
      continue
    }
    const s = asStringValue(v)
    if (s) {
      out.push(s)
    }
  }
  return out
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

export const percentage: FilterEvaluator = (_featureKey, params, ctx) => {
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
  return identityBucket(ctx.identity) < pct
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

  if (identity) {
    const exclusionUsers = collectPrefixedStrings(
      params,
      'Audience.Exclusion.Users',
    )
    if (contains(exclusionUsers, identity, ignoreCase)) {
      return false
    }
  }

  if (ctx.groups && ctx.groups.length > 0) {
    const exclusionGroups = collectPrefixedStrings(
      params,
      'Audience.Exclusion.Groups',
    )
    for (const g of ctx.groups) {
      if (contains(exclusionGroups, g, ignoreCase)) {
        return false
      }
    }
  }

  if (identity) {
    const users = collectPrefixedStrings(params, 'Audience.Users')
    if (contains(users, identity, ignoreCase)) {
      return true
    }
  }

  if (ctx.groups && ctx.groups.length > 0) {
    const groups = collectPrefixedStrings(params, 'Audience.Groups')
    for (const g of ctx.groups) {
      if (contains(groups, g, ignoreCase)) {
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
  return rolloutBucket(featureKey, identity) < pct
}

export function createDefaultRegistry(): Map<string, FilterEvaluator> {
  const reg = new Map<string, FilterEvaluator>()
  reg.set('AlwaysOn', alwaysOn)
  reg.set('AlwaysOff', alwaysOff)
  reg.set('Percentage', percentage)
  reg.set('TimeWindow', timeWindow)
  reg.set('Targeting', targeting)
  return reg
}

/** Exported for tests that need bucket values. */
export { identityBucket, rolloutBucket }
