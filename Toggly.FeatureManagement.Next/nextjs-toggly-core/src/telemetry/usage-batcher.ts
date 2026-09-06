import { hashIdentity, toProtobufTimestamp } from './hash.js'

/** Hard caps aligned with PHP/.NET unique-hash limits. */
export const MAX_UNIQUE_USER_HASHES_PER_FEATURE = 10_000
export const MAX_APPLICATION_UNIQUE_USER_HASHES = 10_000
/** Max distinct feature keys retained in one in-memory batch. */
export const MAX_FEATURES_PER_BATCH = 500

export interface VariantStatsAgg {
  checkCount: number
  requestCount: number
  usedCount: number
  viewedCount: number
}

export interface FeatureUsageAgg {
  variantStats: Map<string, VariantStatsAgg>
  uniqueUsersEnabled: Set<number>
  uniqueUsersDisabled: Set<number>
  uniqueUsersUsed: Set<number>
  uniqueUsersViewed: Set<number>
  uniqueUserHashes: Set<number>
  uniqueViewedUserHashes: Set<number>
}

export interface UsageBatcherOptions {
  appKey: string
  environment: string
  instanceName?: string
  appVersion?: string
  processStartTime?: Date
  maxUniqueHashesPerFeature?: number
  maxApplicationUniqueHashes?: number
  maxFeatures?: number
}

export interface FeatureStatPayload {
  appKey: string
  environment: string
  time: { seconds: number; nanos: number }
  stats: Array<{
    feature: string
    uniqueContextIdentifierEnabledCount: number
    uniqueContextIdentifierDisabledCount: number
    uniqueUsersUsedCount: number
    uniqueUserHashes: number[]
    uniqueViewedUserHashes: number[]
    variantStats: Record<string, VariantStatsAgg>
  }>
  totalUniqueUsers: number
  uniqueUserHashes: number[]
  instanceName?: string
  appVersion?: string
  processStartTime?: { seconds: number; nanos: number }
}

/**
 * Wire payload plus uniqueness hash-set snapshots for soft-fail HTTPS restore.
 */
export interface UsageFlushBundle {
  payload: FeatureStatPayload
  uniqueUsersEnabled: Record<string, number[]>
  uniqueUsersDisabled: Record<string, number[]>
  uniqueUsersUsed: Record<string, number[]>
}

function emptyVariant(): VariantStatsAgg {
  return { checkCount: 0, requestCount: 0, usedCount: 0, viewedCount: 0 }
}

function emptyFeature(): FeatureUsageAgg {
  return {
    variantStats: new Map(),
    uniqueUsersEnabled: new Set(),
    uniqueUsersDisabled: new Set(),
    uniqueUsersUsed: new Set(),
    uniqueUsersViewed: new Set(),
    uniqueUserHashes: new Set(),
    uniqueViewedUserHashes: new Set(),
  }
}

/**
 * In-memory feature usage aggregator. Prefer variantStats over legacy scalars
 * (matches .NET TogglyUsageStatsProvider send shape).
 */
export class UsageBatcher {
  private readonly appKey: string
  private readonly environment: string
  private readonly instanceName?: string
  private readonly appVersion?: string
  private readonly processStartTime: Date
  private readonly maxUniqueHashesPerFeature: number
  private readonly maxApplicationUniqueHashes: number
  private readonly maxFeatures: number
  private perFeature = new Map<string, FeatureUsageAgg>()
  private appUnique = new Set<number>()
  private droppedFeatures = false

  constructor(options: UsageBatcherOptions) {
    this.appKey = options.appKey
    this.environment = options.environment
    this.instanceName = options.instanceName
    this.appVersion = options.appVersion
    this.processStartTime = options.processStartTime ?? new Date()
    this.maxUniqueHashesPerFeature =
      options.maxUniqueHashesPerFeature ?? MAX_UNIQUE_USER_HASHES_PER_FEATURE
    this.maxApplicationUniqueHashes =
      options.maxApplicationUniqueHashes ?? MAX_APPLICATION_UNIQUE_USER_HASHES
    this.maxFeatures = options.maxFeatures ?? MAX_FEATURES_PER_BATCH
  }

  private get(feature: string): FeatureUsageAgg | null {
    let agg = this.perFeature.get(feature)
    if (!agg) {
      if (this.perFeature.size >= this.maxFeatures) {
        this.droppedFeatures = true
        return null
      }
      agg = emptyFeature()
      this.perFeature.set(feature, agg)
    }
    return agg
  }

  private getVariant(agg: FeatureUsageAgg, variant: string): VariantStatsAgg {
    let stats = agg.variantStats.get(variant)
    if (!stats) {
      stats = emptyVariant()
      agg.variantStats.set(variant, stats)
    }
    return stats
  }

  private addHashCapped(set: Set<number>, hash: number, max: number): void {
    if (set.has(hash) || set.size < max) {
      set.add(hash)
    }
  }

  private trackAppUnique(hash: number): void {
    this.addHashCapped(this.appUnique, hash, this.maxApplicationUniqueHashes)
  }

  /**
   * Record a feature evaluation.
   *
   * `checkCount` increments on every call. `requestCount` maps to .NET
   * UniqueRequestEnabled/Disabled when `uniqueRequest` is true.
   */
  recordCheck(
    feature: string,
    enabled: boolean,
    identity?: string,
    variant?: string,
    uniqueRequest = false,
  ): void {
    const agg = this.get(feature)
    if (!agg) return

    const name = variant ?? (enabled ? 'enabled' : 'disabled')
    const stats = this.getVariant(agg, name)
    stats.checkCount += 1
    if (uniqueRequest) {
      stats.requestCount += 1
    }

    if (identity) {
      const hash = hashIdentity(identity)
      this.trackAppUnique(hash)
      if (enabled) {
        this.addHashCapped(agg.uniqueUsersEnabled, hash, this.maxUniqueHashesPerFeature)
      } else {
        this.addHashCapped(agg.uniqueUsersDisabled, hash, this.maxUniqueHashesPerFeature)
      }
    }
  }

  recordUsage(feature: string, identity?: string, variant = 'enabled'): void {
    const agg = this.get(feature)
    if (!agg) return

    this.getVariant(agg, variant).usedCount += 1
    if (identity) {
      const hash = hashIdentity(identity)
      this.trackAppUnique(hash)
      this.addHashCapped(agg.uniqueUsersUsed, hash, this.maxUniqueHashesPerFeature)
      this.addHashCapped(agg.uniqueUserHashes, hash, this.maxUniqueHashesPerFeature)
    }
  }

  recordView(feature: string, identity?: string, variant = 'enabled'): void {
    const agg = this.get(feature)
    if (!agg) return

    this.getVariant(agg, variant).viewedCount += 1
    if (identity) {
      const hash = hashIdentity(identity)
      this.trackAppUnique(hash)
      this.addHashCapped(agg.uniqueUsersViewed, hash, this.maxUniqueHashesPerFeature)
      this.addHashCapped(agg.uniqueViewedUserHashes, hash, this.maxUniqueHashesPerFeature)
    }
  }

  isEmpty(): boolean {
    return this.perFeature.size === 0 && this.appUnique.size === 0
  }

  hitFeatureCap(): boolean {
    return this.droppedFeatures
  }

  featureCount(): number {
    return this.perFeature.size
  }

  buildAndReset(): UsageFlushBundle | null {
    if (this.isEmpty()) {
      return null
    }

    const payload: FeatureStatPayload = {
      appKey: this.appKey,
      environment: this.environment,
      time: toProtobufTimestamp(),
      stats: [],
      totalUniqueUsers: this.appUnique.size,
      uniqueUserHashes: [...this.appUnique],
      processStartTime: toProtobufTimestamp(this.processStartTime),
    }

    if (this.instanceName) {
      payload.instanceName = this.instanceName
    }
    if (this.appVersion) {
      payload.appVersion = this.appVersion
    }

    const uniqueUsersEnabled: Record<string, number[]> = {}
    const uniqueUsersDisabled: Record<string, number[]> = {}
    const uniqueUsersUsed: Record<string, number[]> = {}

    for (const [feature, agg] of this.perFeature) {
      const variantStats: Record<string, VariantStatsAgg> = {}
      for (const [name, stats] of agg.variantStats) {
        if (
          stats.checkCount > 0 ||
          stats.requestCount > 0 ||
          stats.usedCount > 0 ||
          stats.viewedCount > 0
        ) {
          variantStats[name] = { ...stats }
        }
      }

      if (agg.uniqueUsersEnabled.size > 0) {
        uniqueUsersEnabled[feature] = [...agg.uniqueUsersEnabled]
      }
      if (agg.uniqueUsersDisabled.size > 0) {
        uniqueUsersDisabled[feature] = [...agg.uniqueUsersDisabled]
      }
      if (agg.uniqueUsersUsed.size > 0) {
        uniqueUsersUsed[feature] = [...agg.uniqueUsersUsed]
      }

      payload.stats.push({
        feature,
        uniqueContextIdentifierEnabledCount: agg.uniqueUsersEnabled.size,
        uniqueContextIdentifierDisabledCount: agg.uniqueUsersDisabled.size,
        uniqueUsersUsedCount: agg.uniqueUsersUsed.size,
        uniqueUserHashes: [...agg.uniqueUserHashes],
        uniqueViewedUserHashes: [...agg.uniqueViewedUserHashes],
        variantStats,
      })
    }

    this.perFeature = new Map()
    this.appUnique = new Set()
    this.droppedFeatures = false
    return {
      payload,
      uniqueUsersEnabled,
      uniqueUsersDisabled,
      uniqueUsersUsed,
    }
  }

  restoreFromBundle(bundle: UsageFlushBundle): void {
    const { payload } = bundle

    for (const hash of payload.uniqueUserHashes ?? []) {
      this.trackAppUnique(hash)
    }

    for (const stat of payload.stats ?? []) {
      const feature = stat.feature
      if (!feature) continue
      const agg = this.get(feature)
      if (!agg) continue

      for (const [name, vs] of Object.entries(stat.variantStats ?? {})) {
        const target = this.getVariant(agg, name)
        target.checkCount += vs.checkCount ?? 0
        target.requestCount += vs.requestCount ?? 0
        target.usedCount += vs.usedCount ?? 0
        target.viewedCount += vs.viewedCount ?? 0
      }
      for (const hash of stat.uniqueUserHashes ?? []) {
        this.addHashCapped(agg.uniqueUserHashes, hash, this.maxUniqueHashesPerFeature)
      }
      for (const hash of stat.uniqueViewedUserHashes ?? []) {
        this.addHashCapped(agg.uniqueViewedUserHashes, hash, this.maxUniqueHashesPerFeature)
        this.addHashCapped(agg.uniqueUsersViewed, hash, this.maxUniqueHashesPerFeature)
      }
    }

    this.mergeUniqueHashMap(bundle.uniqueUsersEnabled, 'uniqueUsersEnabled')
    this.mergeUniqueHashMap(bundle.uniqueUsersDisabled, 'uniqueUsersDisabled')
    this.mergeUniqueHashMap(bundle.uniqueUsersUsed, 'uniqueUsersUsed')
  }

  private mergeUniqueHashMap(
    snapshot: Record<string, number[]>,
    field: 'uniqueUsersEnabled' | 'uniqueUsersDisabled' | 'uniqueUsersUsed',
  ): void {
    for (const [feature, hashes] of Object.entries(snapshot ?? {})) {
      const agg = this.get(feature)
      if (!agg) continue
      for (const hash of hashes) {
        this.addHashCapped(agg[field], hash, this.maxUniqueHashesPerFeature)
        this.trackAppUnique(hash)
      }
    }
  }
}
