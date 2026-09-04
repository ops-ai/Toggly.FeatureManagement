import { UAParser } from 'ua-parser-js'
import type { FilterEvaluator } from './types'
import { asFloat, asString, collectIndexedValues } from './params'
import { computePercentile } from './hash'

function eq(a: string, b: string, ignoreCase: boolean): boolean {
  return ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b
}

function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/**
 * Percentage gate for segment filters.
 * Sticky SHA-256 when identity is present; otherwise Math.random().
 */
export function passesSegmentPercentageGate(
  percentage: number | undefined,
  featureKey: string,
  identity?: string,
): boolean {
  if (percentage === undefined || percentage <= 0) {
    return false
  }
  if (percentage >= 100) {
    return true
  }
  if (identity) {
    return computePercentile(identity, featureKey) < percentage
  }
  return Math.random() * 100 < percentage
}

function parseUserAgent(userAgent?: string): UAParser.IResult | null {
  if (!userAgent) {
    return null
  }
  return new UAParser(userAgent).getResult()
}

function browserFamilyField(parsed: UAParser.IResult): string {
  return parsed.browser.name ?? 'Other'
}

function osFamilyField(parsed: UAParser.IResult): string {
  return parsed.os.name ?? 'Other'
}

function deviceFamilyField(parsed: UAParser.IResult): string {
  return parsed.device.model ?? 'Other'
}

export const browserFamily: FilterEvaluator = (featureKey, params, ctx) => {
  const percentage = asFloat(params, 'Percentage')
  if (!passesSegmentPercentageGate(percentage, featureKey, ctx.identity)) {
    return false
  }
  const values = collectIndexedValues(params, ['BrowserFamily'])
  if (values.length === 0) {
    return false
  }
  const parsed = parseUserAgent(ctx.request?.userAgent)
  const family = parsed ? browserFamilyField(parsed) : null
  if (!family || family === 'Other') {
    return false
  }
  return values.some((v) => containsIgnoreCase(family, v))
}

export const browserLanguage: FilterEvaluator = (featureKey, params, ctx) => {
  const percentage = asFloat(params, 'Percentage')
  if (!passesSegmentPercentageGate(percentage, featureKey, ctx.identity)) {
    return false
  }
  const values = collectIndexedValues(params, ['BrowserLanguage'])
  if (values.length === 0) {
    return false
  }
  const acceptLanguage = ctx.request?.acceptLanguage
  if (!acceptLanguage) {
    return false
  }
  return values.some((v) => containsIgnoreCase(acceptLanguage, v))
}

export const country: FilterEvaluator = (featureKey, params, ctx) => {
  const percentage = asFloat(params, 'Percentage')
  if (!passesSegmentPercentageGate(percentage, featureKey, ctx.identity)) {
    return false
  }
  const values = collectIndexedValues(params, ['Country'])
  if (values.length === 0) {
    return false
  }
  const c = ctx.request?.country
  if (!c) {
    return false
  }
  return values.some((v) => eq(v, c, true))
}

export const deviceType: FilterEvaluator = (featureKey, params, ctx) => {
  const percentage = asFloat(params, 'Percentage')
  if (!passesSegmentPercentageGate(percentage, featureKey, ctx.identity)) {
    return false
  }
  const values = collectIndexedValues(params, ['DeviceType'])
  if (values.length === 0) {
    return false
  }
  const parsed = parseUserAgent(ctx.request?.userAgent)
  if (!parsed) {
    return false
  }
  const family = deviceFamilyField(parsed)
  if (family === 'Other') {
    return false
  }
  return values.some((v) => containsIgnoreCase(family, v))
}

export const operatingSystem: FilterEvaluator = (featureKey, params, ctx) => {
  const percentage = asFloat(params, 'Percentage')
  if (!passesSegmentPercentageGate(percentage, featureKey, ctx.identity)) {
    return false
  }
  const values = collectIndexedValues(params, ['OperatingSystem'])
  if (values.length === 0) {
    return false
  }
  const parsed = parseUserAgent(ctx.request?.userAgent)
  if (!parsed) {
    return false
  }
  const family = osFamilyField(parsed)
  if (family === 'Other') {
    return false
  }
  return values.some((v) => containsIgnoreCase(family, v))
}

export const userClaims: FilterEvaluator = (featureKey, params, ctx) => {
  const percentage = asFloat(params, 'Percentage')
  if (!passesSegmentPercentageGate(percentage, featureKey, ctx.identity)) {
    return false
  }
  const claimType = asString(params, 'Claim')
  const claimValue = asString(params, 'Value')
  if (!claimType || !claimValue) {
    return false
  }
  const actual = ctx.claims?.[claimType]
  if (actual === undefined) {
    return false
  }
  return actual === claimValue
}

/** Register Definitions / .NET Web filter name aliases. */
export function registerSegmentFilters(
  reg: Map<string, FilterEvaluator>,
): void {
  const register = (names: string[], ev: FilterEvaluator) => {
    for (const name of names) {
      reg.set(name, ev)
    }
  }
  register(['BrowserFamily'], browserFamily)
  register(['BrowserLanguage'], browserLanguage)
  register(['Country', 'CountryFamily'], country)
  register(['DeviceType'], deviceType)
  register(['OS', 'OperatingSystem'], operatingSystem)
  register(['UserClaims'], userClaims)
}
