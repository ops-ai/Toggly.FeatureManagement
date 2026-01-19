/*
 * Public API Surface of @ops-ai/ngx-feature-flags-toggly
 */

// Configuration
export * from './lib/toggly-options'
export * from './lib/models'

// Service
export * from './lib/toggly.service'

// Components & Directives (standalone)
export * from './lib/feature.component'
export * from './lib/feature-template.directive'
export * from './lib/feature.directive'

// Guards (functional + class-based for backward compatibility)
export * from './lib/feature.guard'

// NgModule (for non-standalone apps)
export * from './lib/ngx-feature-flags-toggly.module'
