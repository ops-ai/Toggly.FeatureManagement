import type { TogglyConfig } from '@ops-ai/nuxt-toggly-core'

/**
 * Nuxt module configuration options
 */
export interface ModuleOptions extends TogglyConfig {
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean

  /**
   * Enable server-side feature fetching
   * @default true
   */
  ssr?: boolean

  /**
   * Cache feature definitions in server storage
   * @default true
   */
  serverCache?: boolean

  /**
   * Server cache TTL in milliseconds
   * @default 60000 (1 minute)
   */
  serverCacheTtl?: number

  /**
   * Persist identity to localStorage on client
   * @default true
   */
  persistIdentity?: boolean

  /**
   * Persist features to localStorage on client for offline support
   * @default false
   */
  persistFeatures?: boolean

  /**
   * Auto-import composables
   * @default true
   */
  autoImport?: boolean

  /**
   * Register global components (Feature, FeatureEnabled, FeatureDisabled)
   * @default true
   */
  globalComponents?: boolean

  /**
   * Register global directives (v-feature, v-feature-show, v-feature-class)
   * @default true
   */
  globalDirectives?: boolean
}

/**
 * Runtime configuration passed to Nuxt
 */
export interface RuntimeConfig {
  toggly: ModuleOptions
}

declare module '@nuxt/schema' {
  interface RuntimeConfig {
    toggly: ModuleOptions
  }

  interface PublicRuntimeConfig {
    toggly: ModuleOptions
  }
}

declare module 'nuxt/schema' {
  interface RuntimeConfig {
    toggly: ModuleOptions
  }

  interface PublicRuntimeConfig {
    toggly: ModuleOptions
  }
}
