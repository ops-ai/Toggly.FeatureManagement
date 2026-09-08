import { hashIdentity, toProtobufTimestamp } from './grpc-clients.js'

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
  /** Definition-refresh cache hits since last successful flush (optional proto field). */
  definitionCacheHits?: number
  /** Definition-refresh cache misses since last successful flush (optional proto field). */
  definitionCacheMisses?: number
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
  private perFeature = new Map<string, FeatureUsageAgg>()
  private appUnique = new Set<number>()
  private definitionCacheHits = 0
  private definitionCacheMisses = 0

  constructor(options: UsageBatcherOptions) {
    this.appKey = options.appKey
    this.environment = options.environment
    this.instanceName = options.instanceName
    this.appVersion = options.appVersion
    this.processStartTime = options.processStartTime ?? new Date()
  }

  /** Count a definition-refresh outcome served from local/cache (not a new revision). */
  recordDefinitionCacheHit(): void {
    this.definitionCacheHits += 1
  }

  /** Count a definition-refresh that applied a new revision from the network. */
  recordDefinitionCacheMiss(): void {
    this.definitionCacheMisses += 1
  }

  private get(feature: string): FeatureUsageAgg {
    let agg = this.perFeature.get(feature)
    if (!agg) {
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

  private trackIdentity(identity: string | undefined, into: Set<number>): void {
    if (!identity) return
    const hash = hashIdentity(identity)
    this.appUnique.add(hash)
    into.add(hash)
  }

  /**
   * Record a feature evaluation.
   *
   * `checkCount` increments on every call. `requestCount` maps to .NET
   * UniqueRequestEnabled/Disabled: only the first check of a feature within a
   * logical request. Pass `uniqueRequest: true` for that first access (Go
   * leaves requestCount unset; without request scope, leave it false).
   */
  recordCheck(
    feature: string,
    enabled: boolean,
    identity?: string,
    variant?: string,
    uniqueRequest = false,
  ): void {
    const agg = this.get(feature)
    const name = variant ?? (enabled ? 'enabled' : 'disabled')
    const stats = this.getVariant(agg, name)
    stats.checkCount += 1
    // Unique request ≠ every check (see JSDoc above).
    if (uniqueRequest) {
      stats.requestCount += 1
    }

    if (identity) {
      const hash = hashIdentity(identity)
      this.appUnique.add(hash)
      if (enabled) {
        agg.uniqueUsersEnabled.add(hash)
      } else {
        agg.uniqueUsersDisabled.add(hash)
      }
    }
  }

  recordUsage(feature: string, identity?: string, variant = 'enabled'): void {
    const agg = this.get(feature)
    this.getVariant(agg, variant).usedCount += 1
    this.trackIdentity(identity, agg.uniqueUsersUsed)
    if (identity) {
      agg.uniqueUserHashes.add(hashIdentity(identity))
    }
  }

  recordView(feature: string, identity?: string, variant = 'enabled'): void {
    const agg = this.get(feature)
    this.getVariant(agg, variant).viewedCount += 1
    this.trackIdentity(identity, agg.uniqueUsersViewed)
    if (identity) {
      const hash = hashIdentity(identity)
      this.appUnique.add(hash)
      agg.uniqueViewedUserHashes.add(hash)
    }
  }

  isEmpty(): boolean {
    return (
      this.perFeature.size === 0 &&
      this.appUnique.size === 0 &&
      this.definitionCacheHits === 0 &&
      this.definitionCacheMisses === 0
    )
  }

  buildAndReset(): FeatureStatPayload | null {
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
    if (this.definitionCacheHits > 0) {
      payload.definitionCacheHits = this.definitionCacheHits
    }
    if (this.definitionCacheMisses > 0) {
      payload.definitionCacheMisses = this.definitionCacheMisses
    }

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
    this.definitionCacheHits = 0
    this.definitionCacheMisses = 0
    return payload
  }
}
